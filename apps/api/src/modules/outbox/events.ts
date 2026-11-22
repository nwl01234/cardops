import type { CardDto, OperationAction, RealtimeEvent, UserRef } from '@cardops/shared';
import type { RealtimePayload } from './outbox.repo';

export function buildRealtimePayload(
  type: OperationAction,
  card: CardDto,
  actor: UserRef | null,
  occurredAt: Date,
): RealtimePayload {
  return {
    type,
    occurredAt: occurredAt.toISOString(),
    card: {
      id: card.id,
      sku: card.sku,
      title: card.title,
      status: card.status,
      warehouseId: card.warehouse.id,
      ownerId: card.owner?.id ?? null,
      holderId: card.holder?.id ?? null,
    },
    actor,
  } satisfies Omit<RealtimeEvent, 'id'>;
}
