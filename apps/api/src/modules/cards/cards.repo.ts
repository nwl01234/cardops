import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { CardDto, CardListQuery, CardStatus, Page, Role } from '@cardops/shared';
import type { DbExecutor } from '../../db/client';
import { cards, users, warehouses, type CardRow } from '../../db/schema';
import { AppError } from '../../lib/errors';

const ownerUser = alias(users, 'owner_user');
const holderUser = alias(users, 'holder_user');

export interface CardScope {
  role: Role;
  id: string;
  warehouseId: string | null;
}

interface CardProjection {
  id: string;
  sku: string;
  title: string;
  maskedNumber: string | null;
  status: CardStatus;
  version: number;
  notes: string | null;
  writtenOffReason: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  warehouseCity: string;
  ownerId: string | null;
  ownerLogin: string | null;
  ownerName: string | null;
  holderId: string | null;
  holderLogin: string | null;
  holderName: string | null;
}

const cardSelection = {
  id: cards.id,
  sku: cards.sku,
  title: cards.title,
  maskedNumber: cards.maskedNumber,
  status: cards.status,
  version: cards.version,
  notes: cards.notes,
  writtenOffReason: cards.writtenOffReason,
  issuedAt: cards.issuedAt,
  createdAt: cards.createdAt,
  updatedAt: cards.updatedAt,
  warehouseId: warehouses.id,
  warehouseCode: warehouses.code,
  warehouseName: warehouses.name,
  warehouseCity: warehouses.city,
  ownerId: ownerUser.id,
  ownerLogin: ownerUser.login,
  ownerName: ownerUser.name,
  holderId: holderUser.id,
  holderLogin: holderUser.login,
  holderName: holderUser.name,
};

function cardQuery(db: DbExecutor) {
  return db
    .select(cardSelection)
    .from(cards)
    .innerJoin(warehouses, eq(cards.warehouseId, warehouses.id))
    .leftJoin(ownerUser, eq(cards.ownerId, ownerUser.id))
    .leftJoin(holderUser, eq(cards.holderId, holderUser.id));
}

function mapCard(row: CardProjection): CardDto {
  return {
    id: row.id,
    sku: row.sku,
    title: row.title,
    maskedNumber: row.maskedNumber,
    status: row.status,
    version: row.version,
    notes: row.notes,
    writtenOffReason: row.writtenOffReason,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    warehouse: {
      id: row.warehouseId,
      code: row.warehouseCode,
      name: row.warehouseName,
      city: row.warehouseCity,
    },
    owner:
      row.ownerId && row.ownerLogin && row.ownerName
        ? { id: row.ownerId, login: row.ownerLogin, name: row.ownerName }
        : null,
    holder:
      row.holderId && row.holderLogin && row.holderName
        ? { id: row.holderId, login: row.holderLogin, name: row.holderName }
        : null,
  };
}

/**
 * SQL predicate mirroring the object-level policy. Kept next to the mapper so
 * list, dashboard, audit and scan can never drift from each other.
 */
export function scopeCondition(scope: CardScope): SQL | undefined {
  switch (scope.role) {
    case 'admin':
      return undefined;
    case 'warehouse':
      return scope.warehouseId ? eq(cards.warehouseId, scope.warehouseId) : sql`false`;
    case 'manager':
      return or(eq(cards.ownerId, scope.id), eq(cards.holderId, scope.id));
  }
}

export function canAccessCard(
  scope: CardScope,
  card: { warehouseId: string; ownerId: string | null; holderId: string | null },
): boolean {
  switch (scope.role) {
    case 'admin':
      return true;
    case 'warehouse':
      return scope.warehouseId !== null && card.warehouseId === scope.warehouseId;
    case 'manager':
      return card.ownerId === scope.id || card.holderId === scope.id;
  }
}

export function assertCardAccess(
  scope: CardScope,
  card: { warehouseId: string; ownerId: string | null; holderId: string | null },
): void {
  if (!canAccessCard(scope, card)) {
    throw AppError.forbidden('This card belongs to another warehouse or manager');
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function listFilter(scope: CardScope, query: CardListQuery): SQL | undefined {
  const conditions: Array<SQL | undefined> = [scopeCondition(scope)];

  if (query.status) conditions.push(eq(cards.status, query.status));
  if (query.warehouseId) conditions.push(eq(cards.warehouseId, query.warehouseId));
  if (query.mine) {
    conditions.push(or(eq(cards.holderId, scope.id), eq(cards.ownerId, scope.id)));
  }
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    conditions.push(or(ilike(cards.sku, pattern), ilike(cards.title, pattern)));
  }

  return and(...conditions);
}

export async function listCards(
  db: DbExecutor,
  scope: CardScope,
  query: CardListQuery,
): Promise<Page<CardDto>> {
  const where = listFilter(scope, query);

  const totalRows = await db.select({ value: count() }).from(cards).where(where);
  const rows = await cardQuery(db)
    .where(where)
    .orderBy(desc(cards.createdAt), desc(cards.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    items: rows.map(mapCard),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function findCardDto(db: DbExecutor, id: string): Promise<CardDto | null> {
  const rows = await cardQuery(db).where(eq(cards.id, id)).limit(1);
  return rows[0] ? mapCard(rows[0]) : null;
}

export async function findCardBySku(db: DbExecutor, sku: string): Promise<CardDto | null> {
  const rows = await cardQuery(db).where(eq(cards.sku, sku)).limit(1);
  return rows[0] ? mapCard(rows[0]) : null;
}

/** SELECT ... FOR UPDATE serialises concurrent transitions on the same card. */
export async function lockCard(tx: DbExecutor, id: string): Promise<CardRow | null> {
  const rows = await tx.select().from(cards).where(eq(cards.id, id)).for('update');
  return rows[0] ?? null;
}

export async function insertCard(
  tx: DbExecutor,
  values: typeof cards.$inferInsert,
): Promise<CardRow> {
  const rows = await tx.insert(cards).values(values).returning();
  const row = rows[0];
  if (!row) throw new Error('Card insert returned no row');
  return row;
}

export async function updateCard(
  tx: DbExecutor,
  id: string,
  values: Partial<typeof cards.$inferInsert>,
): Promise<CardRow> {
  const rows = await tx.update(cards).set(values).where(eq(cards.id, id)).returning();
  const row = rows[0];
  if (!row) throw new Error('Card update returned no row');
  return row;
}
