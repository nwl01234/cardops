import {
  CARD_STATUSES,
  OPERATION_ACTIONS,
  ROLES,
  type CardStatus,
  type OperationAction,
  type Role,
} from '@cardops/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('user_role', [...ROLES]);
export const cardStatusEnum = pgEnum('card_status', [...CARD_STATUSES]);
export const operationActionEnum = pgEnum('operation_action', [...OPERATION_ACTIONS]);

const timestamps = () => ({
  createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const warehouses = pgTable('warehouses', {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(),
  name: text().notNull(),
  city: text().notNull(),
  createdAt: timestamps().createdAt,
});

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    login: text().notNull().unique(),
    passwordHash: text().notNull(),
    name: text().notNull(),
    role: roleEnum().notNull(),
    warehouseId: uuid().references(() => warehouses.id, { onDelete: 'restrict' }),
    isActive: boolean().notNull().default(true),
    createdAt: timestamps().createdAt,
    updatedAt: timestamps().updatedAt,
  },
  (table) => [
    index('users_role_idx').on(table.role),
    check(
      'users_warehouse_scope_check',
      sql`(${table.role} = 'warehouse' and ${table.warehouseId} is not null) or (${table.role} <> 'warehouse')`,
    ),
  ],
);

export const cards = pgTable(
  'cards',
  {
    id: uuid().primaryKey().defaultRandom(),
    sku: text().notNull().unique(),
    title: text().notNull(),
    maskedNumber: text(),
    status: cardStatusEnum().notNull().default('in_stock'),
    warehouseId: uuid()
      .notNull()
      .references(() => warehouses.id, { onDelete: 'restrict' }),
    ownerId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    holderId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    notes: text(),
    issuedAt: timestamp({ withTimezone: true, mode: 'date' }),
    writtenOffReason: text(),
    version: integer().notNull().default(0),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (table) => [
    index('cards_status_idx').on(table.status),
    index('cards_warehouse_status_idx').on(table.warehouseId, table.status),
    index('cards_holder_idx').on(table.holderId),
    index('cards_owner_idx').on(table.ownerId),
    index('cards_created_at_idx').on(table.createdAt.desc()),
    check(
      'cards_issued_requires_holder',
      sql`${table.status} <> 'issued' or ${table.holderId} is not null`,
    ),
    check(
      'cards_written_off_requires_reason',
      sql`${table.status} <> 'written_off' or ${table.writtenOffReason} is not null`,
    ),
    check('cards_version_non_negative', sql`${table.version} >= 0`),
  ],
);

export const operations = pgTable(
  'operations',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    action: operationActionEnum().notNull(),
    entityType: text().notNull().default('card'),
    entityId: uuid().notNull(),
    fromStatus: cardStatusEnum(),
    toStatus: cardStatusEnum(),
    details: jsonb().$type<Record<string, unknown>>(),
    requestId: text().notNull(),
    idempotencyKey: text(),
    createdAt: timestamps().createdAt,
  },
  (table) => [
    index('operations_created_at_idx').on(table.createdAt.desc(), table.id.desc()),
    index('operations_entity_idx').on(table.entityId, table.id.desc()),
    index('operations_actor_idx').on(table.actorId),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text().notNull(),
    key: text().notNull(),
    requestHash: text().notNull(),
    status: text().notNull().default('processing'),
    responseStatus: integer(),
    responseBody: jsonb().$type<unknown>(),
    createdAt: timestamps().createdAt,
    completedAt: timestamp({ withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('idempotency_keys_user_endpoint_key_idx').on(
      table.userId,
      table.endpoint,
      table.key,
    ),
    index('idempotency_keys_created_at_idx').on(table.createdAt),
    check('idempotency_keys_status_check', sql`${table.status} in ('processing', 'completed')`),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp({ withTimezone: true, mode: 'date' }),
    replacedBy: uuid(),
    userAgent: text(),
    ip: text(),
    createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_expiry_idx').on(table.expiresAt),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    topic: text().notNull(),
    eventType: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    availableAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true, mode: 'date' }),
    deadLetteredAt: timestamp({ withTimezone: true, mode: 'date' }),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (table) => [
    index('outbox_pending_idx')
      .on(table.availableAt)
      .where(sql`${table.processedAt} is null`),
    index('outbox_processed_at_idx').on(table.processedAt),
  ],
);

export type CardRow = typeof cards.$inferSelect;
export type CardStatusValue = CardStatus;
export type OperationActionValue = OperationAction;
export type RoleValue = Role;
