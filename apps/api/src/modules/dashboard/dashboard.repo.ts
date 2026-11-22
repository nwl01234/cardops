import { and, count, eq, or } from 'drizzle-orm';
import type { CardStatus } from '@cardops/shared';
import type { DbExecutor } from '../../db/client';
import { cards } from '../../db/schema';
import { scopeCondition, type CardScope } from '../cards/cards.repo';

export async function statusCounts(
  db: DbExecutor,
  scope: CardScope,
): Promise<Record<CardStatus, number>> {
  const rows = await db
    .select({ status: cards.status, value: count() })
    .from(cards)
    .where(scopeCondition(scope))
    .groupBy(cards.status);

  const result: Record<CardStatus, number> = {
    in_stock: 0,
    issued: 0,
    returned: 0,
    written_off: 0,
  };
  for (const row of rows) result[row.status] = Number(row.value);
  return result;
}

export async function mineCount(db: DbExecutor, scope: CardScope): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(cards)
    .where(
      and(scopeCondition(scope), or(eq(cards.holderId, scope.id), eq(cards.ownerId, scope.id))),
    );
  return Number(rows[0]?.value ?? 0);
}

export interface WarehouseStatusRow {
  warehouseId: string;
  status: CardStatus;
  value: number;
}

export async function warehouseStatusCounts(
  db: DbExecutor,
  scope: CardScope,
): Promise<WarehouseStatusRow[]> {
  const rows = await db
    .select({ warehouseId: cards.warehouseId, status: cards.status, value: count() })
    .from(cards)
    .where(scopeCondition(scope))
    .groupBy(cards.warehouseId, cards.status);

  return rows.map((row) => ({
    warehouseId: row.warehouseId,
    status: row.status,
    value: Number(row.value),
  }));
}
