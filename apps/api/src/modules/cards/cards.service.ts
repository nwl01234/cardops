import {
  availableTransitions,
  can,
  canRolePerform,
  operationFor,
  transitionTarget,
  type CardDetailDto,
  type CardDto,
  type CardListQuery,
  type CreateCardInput,
  type Page,
  type ScanRequest,
  type TransitionInput,
} from '@cardops/shared';
import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/client';
import { AppError } from '../../lib/errors';
import { generateSku } from '../../lib/ids';
import { runIdempotent, type IdempotentOutcome } from '../../lib/idempotency';
import type { Principal } from '../../http/context';
import { listCardOperations, insertOperation } from '../audit/audit.repo';
import { findActiveManager } from '../users/users.repo';
import { findWarehouseById } from '../warehouses/warehouses.repo';
import { insertOutboxEvent } from '../outbox/outbox.repo';
import { buildRealtimePayload } from '../outbox/events';
import type { OutboxSignal } from '../../realtime/outbox.signal';
import {
  assertCardAccess,
  canAccessCard,
  findCardBySku,
  findCardDto,
  insertCard,
  listCards,
  lockCard,
  updateCard,
} from './cards.repo';

interface MutationContext {
  requestId: string;
  idempotencyKey: string;
}

const DETAIL_OPERATION_LIMIT = 12;

export class CardsService {
  constructor(
    private readonly db: Database,
    private readonly outbox: OutboxSignal,
  ) {}

  async list(principal: Principal, query: CardListQuery): Promise<Page<CardDto>> {
    return listCards(this.db, principal, query);
  }

  async detail(principal: Principal, cardId: string): Promise<CardDetailDto> {
    return this.loadDetail(this.db, principal, cardId);
  }

  async create(
    principal: Principal,
    input: CreateCardInput,
    context: MutationContext,
  ): Promise<IdempotentOutcome<CardDto>> {
    if (!can(principal.role, 'card.create')) {
      throw AppError.forbidden('Your role cannot create cards');
    }

    // Authorise replay as well as the first execution. A saved idempotent
    // response must not become a permission bypass after a role/scope change.
    await this.assertWarehouseAllowed(this.db, principal, input.warehouseId);

    const outcome = await runIdempotent(
      this.db,
      {
        userId: principal.id,
        endpoint: 'POST /api/cards',
        key: context.idempotencyKey,
        payload: input,
      },
      async (tx) => {
        await this.assertWarehouseAllowed(tx, principal, input.warehouseId);

        if (input.ownerId) {
          const owner = await findActiveManager(tx, input.ownerId);
          if (!owner) {
            throw AppError.validation([
              { path: 'ownerId', message: 'Owner must be an active manager' },
            ]);
          }
        }

        const now = new Date();
        const sku = input.sku ?? generateSku();

        let cardId: string;
        try {
          const row = await insertCard(tx, {
            sku,
            title: input.title,
            maskedNumber: input.last4 ? `•••• ${input.last4}` : null,
            status: 'in_stock',
            warehouseId: input.warehouseId,
            ownerId: input.ownerId ?? null,
            holderId: null,
            notes: input.notes ?? null,
            createdBy: principal.id,
            createdAt: now,
            updatedAt: now,
          });
          cardId = row.id;
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new AppError('CONFLICT', `A card with SKU "${sku}" already exists`);
          }
          throw error;
        }

        const card = await findCardDto(tx, cardId);
        if (!card) throw new Error('Created card could not be read back');

        await insertOperation(tx, {
          actorId: principal.id,
          action: 'card.created',
          entityId: card.id,
          fromStatus: null,
          toStatus: 'in_stock',
          details: {
            sku: card.sku,
            warehouseId: card.warehouse.id,
            ownerId: card.owner?.id ?? null,
            last4: input.last4 ?? null,
          },
          requestId: context.requestId,
          idempotencyKey: context.idempotencyKey,
          createdAt: now,
        });

        await insertOutboxEvent(tx, buildRealtimePayload('card.created', card, principal, now));

        return { status: 201, data: card };
      },
    );

    if (!outcome.replayed) this.outbox.wake();
    return outcome;
  }

  async transition(
    principal: Principal,
    cardId: string,
    input: TransitionInput,
    context: MutationContext,
  ): Promise<IdempotentOutcome<CardDetailDto>> {
    // Re-check current scope before replaying a stored response. The actual
    // mutation repeats these checks under a row lock, but a replay never
    // enters the handler.
    const preflight = await findCardDto(this.db, cardId);
    if (!preflight) throw AppError.notFound('Card not found');
    assertCardAccess(principal, {
      warehouseId: preflight.warehouse.id,
      ownerId: preflight.owner?.id ?? null,
      holderId: preflight.holder?.id ?? null,
    });
    if (!canRolePerform(principal.role, input.action)) {
      throw AppError.forbidden(`Role "${principal.role}" cannot perform "${input.action}"`);
    }
    if (
      principal.role === 'manager' &&
      input.action === 'return' &&
      preflight.holder?.id !== principal.id
    ) {
      throw AppError.forbidden('Only the current holder can return this card');
    }

    const outcome = await runIdempotent(
      this.db,
      {
        userId: principal.id,
        endpoint: 'POST /api/cards/:id/transitions',
        key: context.idempotencyKey,
        payload: { cardId, ...input },
      },
      async (tx) => {
        const locked = await lockCard(tx, cardId);
        if (!locked) throw AppError.notFound('Card not found');

        assertCardAccess(principal, {
          warehouseId: locked.warehouseId,
          ownerId: locked.ownerId,
          holderId: locked.holderId,
        });

        if (!canRolePerform(principal.role, input.action)) {
          throw AppError.forbidden(`Role "${principal.role}" cannot perform "${input.action}"`);
        }

        // A manager's object scope includes owned cards, but returning is only
        // valid for the current holder. Ownership must not become an override.
        if (
          principal.role === 'manager' &&
          input.action === 'return' &&
          locked.holderId !== principal.id
        ) {
          throw AppError.forbidden('Only the current holder can return this card');
        }

        if (input.expectedVersion !== undefined && input.expectedVersion !== locked.version) {
          throw new AppError(
            'VERSION_CONFLICT',
            'The card was changed by another request; reload and try again',
            { expected: input.expectedVersion, actual: locked.version },
          );
        }

        const target = transitionTarget(input.action, locked.status);
        if (!target) {
          throw new AppError(
            'INVALID_TRANSITION',
            `Cannot perform "${input.action}" on a card in status "${locked.status}"`,
            { action: input.action, from: locked.status },
          );
        }

        const now = new Date();
        const patch: Parameters<typeof updateCard>[2] = {
          status: target,
          version: locked.version + 1,
          updatedAt: now,
        };
        const details: Record<string, unknown> = { action: input.action };

        switch (input.action) {
          case 'issue': {
            const holder = await findActiveManager(tx, input.holderId);
            if (!holder) {
              throw AppError.validation([
                { path: 'holderId', message: 'Holder must be an active manager' },
              ]);
            }
            patch.holderId = holder.id;
            patch.ownerId = locked.ownerId ?? holder.id;
            patch.issuedAt = now;
            patch.writtenOffReason = null;
            details.holderId = holder.id;
            details.holderName = holder.name;
            break;
          }
          case 'return': {
            if (!locked.holderId) {
              throw new AppError('CONFLICT', 'Card is issued but has no holder');
            }
            patch.holderId = null;
            patch.issuedAt = null;
            patch.writtenOffReason = null;
            details.previousHolderId = locked.holderId;
            break;
          }
          case 'restock': {
            patch.holderId = null;
            patch.issuedAt = null;
            patch.writtenOffReason = null;
            break;
          }
          case 'write_off': {
            patch.holderId = null;
            patch.issuedAt = null;
            patch.writtenOffReason = input.reason;
            details.reason = input.reason;
            break;
          }
        }

        await updateCard(tx, locked.id, patch);

        const card = await findCardDto(tx, locked.id);
        if (!card) throw new Error('Updated card could not be read back');

        await insertOperation(tx, {
          actorId: principal.id,
          action: operationFor(input.action),
          entityId: card.id,
          fromStatus: locked.status,
          toStatus: target,
          details,
          requestId: context.requestId,
          idempotencyKey: context.idempotencyKey,
          createdAt: now,
        });

        await insertOutboxEvent(
          tx,
          buildRealtimePayload(operationFor(input.action), card, principal, now),
        );

        // The actor was already authorised against the pre-update state. Do not
        // re-check object scope against the post-update state: a manager who
        // returns a card owned by someone else legitimately loses access after
        // the update, but the operation itself must commit and return its result.
        const detail = await this.loadDetail(tx, principal, card.id, false);
        return { status: 200, data: detail };
      },
    );

    if (!outcome.replayed) this.outbox.wake();
    return outcome;
  }

  async scan(principal: Principal, input: ScanRequest): Promise<CardDto> {
    const code = input.code.toUpperCase();
    const card = await findCardBySku(this.db, code);

    // Scanning must not become an enumeration oracle: out-of-scope looks absent.
    if (
      !card ||
      !canAccessCard(principal, {
        warehouseId: card.warehouse.id,
        ownerId: card.owner?.id ?? null,
        holderId: card.holder?.id ?? null,
      })
    ) {
      throw AppError.notFound('Card not found');
    }

    return card;
  }

  private async loadDetail(
    db: Database | Parameters<Parameters<Database['transaction']>[0]>[0],
    principal: Principal,
    cardId: string,
    enforceAccess = true,
  ): Promise<CardDetailDto> {
    const card = await findCardDto(db, cardId);
    if (!card) throw AppError.notFound('Card not found');

    if (enforceAccess) {
      assertCardAccess(principal, {
        warehouseId: card.warehouse.id,
        ownerId: card.owner?.id ?? null,
        holderId: card.holder?.id ?? null,
      });
    }

    const operations = await listCardOperations(db, cardId, DETAIL_OPERATION_LIMIT);

    let actions = [...availableTransitions(card.status, principal.role)];
    if (principal.role === 'manager' && card.holder?.id !== principal.id) {
      actions = actions.filter((action) => action !== 'return');
    }

    return {
      ...card,
      operations,
      availableActions: actions,
    };
  }

  private async assertWarehouseAllowed(
    db: Database | Parameters<Parameters<Database['transaction']>[0]>[0],
    principal: Principal,
    warehouseId: string,
  ): Promise<void> {
    const warehouse = await findWarehouseById(db, warehouseId);
    if (!warehouse) {
      throw AppError.validation([{ path: 'warehouseId', message: 'Warehouse not found' }]);
    }

    if (principal.role === 'warehouse' && principal.warehouseId !== warehouseId) {
      throw AppError.forbidden('You can only create cards in your own warehouse');
    }
  }
}
