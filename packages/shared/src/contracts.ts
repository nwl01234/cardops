import { z } from 'zod';
import { cardStatusSchema, operationActionSchema, roleSchema } from './domain';
import type { CardStatus, OperationAction, Role, TransitionAction } from './domain';

export const loginSchema = z.object({
  login: z
    .string()
    .trim()
    .min(3, 'Login must be at least 3 characters')
    .max(64, 'Login is too long'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{3,23}$/, 'SKU must be 4-24 characters: A-Z, 0-9, dash');

const last4Schema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, 'Only the last four digits may be provided');

export const createCardSchema = z.object({
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(120),
  sku: skuSchema.optional(),
  warehouseId: z.uuid('warehouseId must be a UUID'),
  ownerId: z.uuid('ownerId must be a UUID').nullish(),
  last4: last4Schema.optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateCardInput = z.infer<typeof createCardSchema>;

const expectedVersion = z.number().int().min(0).optional();

const issueSchema = z.object({
  action: z.literal('issue'),
  holderId: z.uuid('holderId must be a UUID'),
  expectedVersion,
});

const returnSchema = z.object({
  action: z.literal('return'),
  expectedVersion,
});

const restockSchema = z.object({
  action: z.literal('restock'),
  expectedVersion,
});

const writeOffSchema = z.object({
  action: z.literal('write_off'),
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(300),
  expectedVersion,
});

export const transitionSchema = z.discriminatedUnion('action', [
  issueSchema,
  returnSchema,
  restockSchema,
  writeOffSchema,
]);
export type TransitionInput = z.infer<typeof transitionSchema>;

export const cardListQuerySchema = z.object({
  status: cardStatusSchema.optional(),
  warehouseId: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type CardListQuery = z.infer<typeof cardListQuerySchema>;

export const auditQuerySchema = z.object({
  cardId: z.uuid().optional(),
  action: operationActionSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().regex(/^\d+$/, 'before must be a numeric cursor').optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const scanRequestSchema = z.object({
  code: z.string().trim().min(4).max(64),
});
export type ScanRequest = z.infer<typeof scanRequestSchema>;

export const userListQuerySchema = z.object({
  role: roleSchema.default('manager'),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export interface UserRef {
  id: string;
  login: string;
  name: string;
}

export interface UserDto extends UserRef {
  role: Role;
  warehouseId: string | null;
  warehouseName: string | null;
}

export interface AdminUserDto extends UserDto {
  isActive: boolean;
  createdAt: string;
}

export const adminCreateUserSchema = z.object({
  login: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Login must be at least 3 characters')
    .max(64)
    .regex(/^[a-z0-9._-]+$/, 'Use lowercase letters, digits, dot, dash or underscore'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().trim().min(2).max(120),
  role: roleSchema,
  warehouseId: z.uuid().nullish(),
});
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

export const adminUpdateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(8).max(128).optional(),
  role: roleSchema.optional(),
  warehouseId: z.uuid().nullish(),
  isActive: z.boolean().optional(),
});
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

export interface WarehouseDto {
  id: string;
  code: string;
  name: string;
  city: string;
}

export interface CardDto {
  id: string;
  sku: string;
  title: string;
  maskedNumber: string | null;
  status: CardStatus;
  version: number;
  warehouse: WarehouseDto;
  owner: UserRef | null;
  holder: UserRef | null;
  notes: string | null;
  writtenOffReason: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperationDto {
  id: string;
  action: OperationAction;
  actor: UserRef | null;
  entityType: 'card';
  entityId: string;
  card: { id: string; sku: string; title: string } | null;
  fromStatus: CardStatus | null;
  toStatus: CardStatus | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface CardDetailDto extends CardDto {
  operations: OperationDto[];
  availableActions: TransitionAction[];
}

export interface DashboardStats {
  total: number;
  inStock: number;
  issued: number;
  returned: number;
  writtenOff: number;
  mine: number;
}

export interface WarehouseBreakdown {
  warehouse: WarehouseDto;
  inStock: number;
  issued: number;
  returned: number;
  writtenOff: number;
}

export interface DashboardDto {
  stats: DashboardStats;
  warehouses: WarehouseBreakdown[];
  recentOperations: OperationDto[];
  generatedAt: string;
}

export interface MutationResult<T> {
  data: T;
  meta: MutationMeta;
}

export interface MutationMeta {
  requestId: string;
  idempotencyKey: string;
  replayed: boolean;
}

export interface OutboxStatsDto {
  pending: number;
  processedLastHour: number;
  failed: number;
  oldestPendingAt: string | null;
  lagSeconds: number;
}

export interface OutboxEventDto {
  id: string;
  eventType: string;
  attempts: number;
  occurredAt: string;
  processedAt: string | null;
  lastError: string | null;
}

export interface TraceSpanDto {
  traceId: string | null;
  service: string;
  operation: string;
  durationMs: number;
  status: string;
  at: string;
}

export interface SystemAlertDto {
  code: string;
  severity: 'warning' | 'critical';
  message: string;
}

export interface SystemHealthDto {
  status: 'ok' | 'degraded';
  database: 'up';
  outbox: OutboxStatsDto;
  recentOutbox: OutboxEventDto[];
  realtimeSubscribers: number;
  uptimeSeconds: number;
  version: string;
  worker: { heartbeat: string | null; ageSeconds: number | null };
  nats: string;
  alerts: SystemAlertDto[];
  traces: TraceSpanDto[];
}

export interface OcrResultDto {
  text: string;
  code: string | null;
  confidence: number;
  durationMs: number;
}

export interface RealtimeEvent {
  id: string;
  type: OperationAction;
  occurredAt: string;
  card: {
    id: string;
    sku: string;
    title: string;
    status: CardStatus;
    warehouseId: string;
    ownerId: string | null;
    holderId: string | null;
  };
  actor: UserRef | null;
}

export const REALTIME_EVENT_TYPES = [
  'card.created',
  'card.issued',
  'card.returned',
  'card.restocked',
  'card.written_off',
] as const satisfies readonly OperationAction[];

export type { CardStatus, OperationAction, Role, TransitionAction };
