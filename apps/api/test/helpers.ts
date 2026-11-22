import type { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { CardDto, CreateCardInput, Role, TransitionInput, UserDto } from '@cardops/shared';
import type { AppDeps } from '../src/app.deps';
import { loadConfig } from '../src/config/env';
import { createDatabase, type DatabaseHandle } from '../src/db/client';
import { cards, outboxEvents, operations, users, warehouses } from '../src/db/schema';
import { seedDatabase } from '../src/db/seed-runner';
import type { AppEnv } from '../src/http/context';
import { createApp } from '../src/http/app';
import { createLogger } from '../src/lib/logger';
import { createRedis, type RedisClient } from '../src/lib/redis';
import { RedisRateLimiter } from '../src/modules/auth/rate-limiter';
import { SessionStore } from '../src/modules/auth/session-store';
import { RedisOutboxSignal } from '../src/realtime/outbox.signal';
import { DocumentsClient } from '../src/modules/documents/documents.client';

export interface TestContext {
  deps: AppDeps;
  app: Hono<AppEnv>;
  db: DatabaseHandle['db'];
  redis: RedisClient;
  handle: DatabaseHandle;
}

export interface Fixtures {
  admin: UserDto;
  manager: UserDto;
  warehouseUser: UserDto;
  msk: { id: string; code: string; name: string; city: string };
  spb: { id: string; code: string; name: string; city: string };
}

export async function createTestContext(): Promise<TestContext> {
  const config = loadConfig();
  const handle = createDatabase(config.DATABASE_URL, { max: 5 });
  const logger = createLogger(config);
  const redis = createRedis(config.REDIS_URL);
  const sessions = new SessionStore(redis);

  const deps: AppDeps = {
    config,
    db: handle.db,
    logger,
    redis,
    sessions,
    outbox: new RedisOutboxSignal(redis),
    rateLimiter: new RedisRateLimiter(redis),
    documents: new DocumentsClient(config),
  };

  return {
    deps,
    app: createApp(deps),
    db: handle.db,
    redis,
    handle,
  };
}

export async function resetAndSeed(ctx: TestContext): Promise<void> {
  await ctx.db.execute(sql`
    truncate table operations, outbox_events, idempotency_keys, refresh_tokens, cards, users, warehouses
    restart identity cascade
  `);
  await seedDatabase(ctx.db, { includeDemoCards: false });
}

export async function fixtures(ctx: TestContext): Promise<Fixtures> {
  const userRows = await ctx.db.select().from(users);
  const warehouseRows = await ctx.db.select().from(warehouses);

  const byLogin = new Map(userRows.map((row) => [row.login, row]));
  const byCode = new Map(warehouseRows.map((row) => [row.code, row]));

  const admin = byLogin.get('admin');
  const manager = byLogin.get('manager');
  const warehouseUser = byLogin.get('warehouse');
  const msk = byCode.get('WH-MSK');
  const spb = byCode.get('WH-SPB');

  if (!admin || !manager || !warehouseUser || !msk || !spb) {
    throw new Error('Test fixtures were not seeded');
  }

  const toDto = (user: (typeof userRows)[number]): UserDto => ({
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role as Role,
    warehouseId: user.warehouseId,
    warehouseName: user.warehouseId === msk.id ? msk.name : null,
  });

  return {
    admin: toDto(admin),
    manager: toDto(manager),
    warehouseUser: toDto(warehouseUser),
    msk: { id: msk.id, code: msk.code, name: msk.name, city: msk.city },
    spb: { id: spb.id, code: spb.code, name: spb.name, city: spb.city },
  };
}

export async function loginAs(
  ctx: TestContext,
  login: string,
  password: string,
): Promise<{ cookie: string; refreshCookie: string; user: UserDto }> {
  const response = await ctx.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });

  if (response.status !== 200) {
    throw new Error(`Login failed for ${login}: ${response.status} ${await response.text()}`);
  }

  const cookies = response.headers.getSetCookie();
  const cookie = cookies.find((value) => value.startsWith('cardops_session='))?.split(';')[0];
  const refreshCookie = cookies
    .find((value) => value.startsWith('cardops_refresh='))
    ?.split(';')[0];
  if (!cookie || !refreshCookie) throw new Error('Login did not set both cookies');

  const body = (await response.json()) as { data: { user: UserDto } };
  return { cookie, refreshCookie, user: body.data.user };
}

interface RequestOptions {
  cookie?: string;
  body?: unknown;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export async function request(
  ctx: TestContext,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  return ctx.app.request(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

export async function createCard(
  ctx: TestContext,
  cookie: string,
  input: Partial<CreateCardInput> & { warehouseId: string },
  key: string,
): Promise<CardDto> {
  const body: CreateCardInput = {
    title: 'Тестовая карта',
    last4: '1234',
    ...input,
  };
  const response = await request(ctx, 'POST', '/api/cards', {
    cookie,
    body,
    idempotencyKey: key,
  });
  if (response.status !== 201) {
    throw new Error(`Card creation failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { data: CardDto };
  return payload.data;
}

export async function transition(
  ctx: TestContext,
  cookie: string,
  cardId: string,
  input: TransitionInput,
  key: string,
): Promise<Response> {
  return request(ctx, 'POST', `/api/cards/${cardId}/transitions`, {
    cookie,
    body: input,
    idempotencyKey: key,
  });
}

export async function countRows(
  ctx: TestContext,
  table: typeof cards | typeof operations | typeof outboxEvents,
): Promise<number> {
  const rows = await ctx.db.select({ value: sql<number>`count(*)::int` }).from(table);
  return Number(rows[0]?.value ?? 0);
}
