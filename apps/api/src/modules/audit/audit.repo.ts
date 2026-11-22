import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type {
  AuditQuery,
  CardStatus,
  CursorPage,
  OperationAction,
  OperationDto,
  UserRef,
} from '@cardops/shared';
import type { DbExecutor } from '../../db/client';
import { cards, operations, users } from '../../db/schema';
import { scopeCondition, type CardScope } from '../cards/cards.repo';

interface OperationProjection {
  id: number;
  action: OperationAction;
  entityType: string;
  entityId: string;
  fromStatus: CardStatus | null;
  toStatus: CardStatus | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
  actorId: string | null;
  actorLogin: string | null;
  actorName: string | null;
  cardId: string;
  cardSku: string;
  cardTitle: string;
}

const operationSelection = {
  id: operations.id,
  action: operations.action,
  entityType: operations.entityType,
  entityId: operations.entityId,
  fromStatus: operations.fromStatus,
  toStatus: operations.toStatus,
  details: operations.details,
  createdAt: operations.createdAt,
  actorId: users.id,
  actorLogin: users.login,
  actorName: users.name,
  cardId: cards.id,
  cardSku: cards.sku,
  cardTitle: cards.title,
};

function operationQuery(db: DbExecutor) {
  return db
    .select(operationSelection)
    .from(operations)
    .leftJoin(users, eq(operations.actorId, users.id))
    .innerJoin(cards, eq(operations.entityId, cards.id));
}

function mapOperation(row: OperationProjection): OperationDto {
  const actor: UserRef | null =
    row.actorId && row.actorLogin && row.actorName
      ? { id: row.actorId, login: row.actorLogin, name: row.actorName }
      : null;

  return {
    id: String(row.id),
    action: row.action,
    actor,
    entityType: 'card',
    entityId: row.entityId,
    card: { id: row.cardId, sku: row.cardSku, title: row.cardTitle },
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface InsertOperationValues {
  actorId: string;
  action: OperationAction;
  entityId: string;
  fromStatus: CardStatus | null;
  toStatus: CardStatus | null;
  details: Record<string, unknown>;
  requestId: string;
  idempotencyKey: string | null;
  createdAt: Date;
}

export async function insertOperation(
  tx: DbExecutor,
  values: InsertOperationValues,
): Promise<void> {
  await tx.insert(operations).values({
    actorId: values.actorId,
    action: values.action,
    entityType: 'card',
    entityId: values.entityId,
    fromStatus: values.fromStatus,
    toStatus: values.toStatus,
    details: values.details,
    requestId: values.requestId,
    idempotencyKey: values.idempotencyKey,
    createdAt: values.createdAt,
  });
}

export async function listOperations(
  db: DbExecutor,
  scope: CardScope,
  query: AuditQuery,
): Promise<CursorPage<OperationDto>> {
  const conditions: Array<SQL | undefined> = [scopeCondition(scope)];

  if (query.cardId) conditions.push(eq(operations.entityId, query.cardId));
  if (query.action) conditions.push(eq(operations.action, query.action));
  if (query.before) conditions.push(lt(operations.id, Number(query.before)));

  const rows = await operationQuery(db)
    .where(and(...conditions))
    .orderBy(desc(operations.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(mapOperation),
    nextCursor: hasMore && last ? String(last.id) : null,
  };
}

export async function listCardOperations(
  db: DbExecutor,
  cardId: string,
  limit: number,
): Promise<OperationDto[]> {
  const rows = await operationQuery(db)
    .where(eq(operations.entityId, cardId))
    .orderBy(desc(operations.id))
    .limit(limit);
  return rows.map(mapOperation);
}
