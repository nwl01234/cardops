import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type {
  ApiErrorPayload,
  CardDetailDto,
  CardDto,
  DashboardDto,
  MutationMeta,
  OperationDto,
  Page,
  UserDto,
} from '@cardops/shared';
import {
  countRows,
  createCard,
  createTestContext,
  fixtures,
  loginAs,
  request,
  resetAndSeed,
  transition,
  type Fixtures,
  type TestContext,
} from './helpers';
import { cards, operations, outboxEvents, users } from '../src/db/schema';

interface MutationBody<T> {
  data: T;
  meta: MutationMeta;
}

interface ErrorBody extends ApiErrorPayload {}

let ctx: TestContext;
let fx: Fixtures;

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await resetAndSeed(ctx);
  fx = await fixtures(ctx);
});

afterAll(async () => {
  ctx.redis.disconnect();
  await ctx.handle.close();
});

describe('authentication and authorization', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const response = await ctx.app.request('/api/cards');
    expect(response.status).toBe(401);

    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.requestId).toBeTruthy();
  });

  it('issues an HttpOnly session cookie and rejects a bad password', async () => {
    const response = await request(ctx, 'POST', '/api/auth/login', {
      body: { login: 'admin', password: 'admin123' },
    });
    expect(response.status).toBe(200);

    const setCookie = response.headers.getSetCookie()[0] ?? '';
    expect(setCookie).toMatch(/cardops_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const payload = (await response.json()) as { data: { user: UserDto } };
    expect(payload.data.user.role).toBe('admin');

    const bad = await request(ctx, 'POST', '/api/auth/login', {
      body: { login: 'admin', password: 'wrong-password' },
    });
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('re-reads role and warehouse from the database on every request', async () => {
    const { cookie } = await loginAs(ctx, 'warehouse', 'warehouse123');

    const me = await request(ctx, 'GET', '/api/auth/me', { cookie });
    expect(me.status).toBe(200);

    await ctx.db
      .update(users)
      .set({ isActive: false })
      .where(sql`login = 'warehouse'`);

    const after = await request(ctx, 'GET', '/api/auth/me', { cookie });
    expect(after.status).toBe(401);
  });
});

describe('idempotency', () => {
  it('replays the same response instead of creating a second card', async () => {
    const { cookie } = await loginAs(ctx, 'admin', 'admin123');
    const input = {
      title: 'Карта для идемпотентности',
      warehouseId: fx.msk.id,
      last4: '4242',
    };
    const key = 'test-create-0001';

    const first = await request(ctx, 'POST', '/api/cards', {
      cookie,
      body: input,
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as MutationBody<CardDto>;

    const second = await request(ctx, 'POST', '/api/cards', {
      cookie,
      body: input,
      idempotencyKey: key,
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as MutationBody<CardDto>;

    expect(secondBody.meta.replayed).toBe(true);
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(await countRows(ctx, cards)).toBe(1);
    expect(await countRows(ctx, operations)).toBe(1);
    expect(await countRows(ctx, outboxEvents)).toBe(1);
  });

  it('rejects the same key with a different payload and requires the header', async () => {
    const { cookie } = await loginAs(ctx, 'admin', 'admin123');
    const key = 'test-create-0002';

    const first = await request(ctx, 'POST', '/api/cards', {
      cookie,
      body: { title: 'Первая карта', warehouseId: fx.msk.id },
      idempotencyKey: key,
    });
    expect(first.status).toBe(201);

    const mismatch = await request(ctx, 'POST', '/api/cards', {
      cookie,
      body: { title: 'Другая карта', warehouseId: fx.msk.id },
      idempotencyKey: key,
    });
    expect(mismatch.status).toBe(422);
    expect(((await mismatch.json()) as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');

    const missing = await request(ctx, 'POST', '/api/cards', {
      cookie,
      body: { title: 'Без ключа', warehouseId: fx.msk.id },
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('card lifecycle, audit and conflicts', () => {
  it('issues a card in one transaction and writes an audit row', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const card = await createCard(ctx, admin.cookie, { warehouseId: fx.msk.id }, 'test-issue-0001');

    const response = await transition(
      ctx,
      admin.cookie,
      card.id,
      { action: 'issue', holderId: fx.manager.id },
      'test-issue-0002',
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as MutationBody<CardDetailDto>;
    expect(body.data.status).toBe('issued');
    expect(body.data.holder?.id).toBe(fx.manager.id);
    expect(body.data.operations.map((operation) => operation.action)).toEqual([
      'card.issued',
      'card.created',
    ]);

    expect(await countRows(ctx, operations)).toBe(2);
    expect(await countRows(ctx, outboxEvents)).toBe(2);

    const audit = await request(ctx, 'GET', `/api/audit?cardId=${card.id}`, {
      cookie: admin.cookie,
    });
    expect(audit.status).toBe(200);
    const auditBody = (await audit.json()) as { data: { items: OperationDto[] } };
    expect(auditBody.data.items[0]?.action).toBe('card.issued');
    expect(auditBody.data.items[0]?.actor?.login).toBe('admin');
  });

  it('does not issue twice: same key replays, a new key gets 409', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const card = await createCard(ctx, admin.cookie, { warehouseId: fx.msk.id }, 'test-once-0001');
    const key = 'test-once-0002';
    const input = { action: 'issue' as const, holderId: fx.manager.id };

    const first = await transition(ctx, admin.cookie, card.id, input, key);
    expect(first.status).toBe(200);

    const replay = await transition(ctx, admin.cookie, card.id, input, key);
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as MutationBody<CardDetailDto>).meta.replayed).toBe(true);

    const secondAttempt = await transition(ctx, admin.cookie, card.id, input, 'test-once-0003');
    expect(secondAttempt.status).toBe(409);
    expect(((await secondAttempt.json()) as ErrorBody).error.code).toBe('INVALID_TRANSITION');

    expect(await countRows(ctx, operations)).toBe(2);
  });

  it('serialises concurrent duplicate transitions', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const card = await createCard(ctx, admin.cookie, { warehouseId: fx.msk.id }, 'test-race-0001');
    const key = 'test-race-0002';

    const [a, b] = await Promise.all([
      transition(ctx, admin.cookie, card.id, { action: 'issue', holderId: fx.manager.id }, key),
      transition(ctx, admin.cookie, card.id, { action: 'issue', holderId: fx.manager.id }, key),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    const bodies = [
      (await a.json()) as MutationBody<CardDetailDto>,
      (await b.json()) as MutationBody<CardDetailDto>,
    ];
    expect(bodies.filter((body) => body.meta.replayed)).toHaveLength(1);
    expect(await countRows(ctx, operations)).toBe(2);
  });

  it('rejects an invalid transition and a stale expectedVersion', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const card = await createCard(
      ctx,
      admin.cookie,
      { warehouseId: fx.msk.id },
      'test-invalid-0001',
    );

    const writeOff = await transition(
      ctx,
      admin.cookie,
      card.id,
      { action: 'write_off', reason: 'Потеряна' },
      'test-invalid-0002',
    );
    expect(writeOff.status).toBe(200);

    const restock = await transition(
      ctx,
      admin.cookie,
      card.id,
      { action: 'restock' },
      'test-invalid-0003',
    );
    expect(restock.status).toBe(409);
    expect(((await restock.json()) as ErrorBody).error.code).toBe('INVALID_TRANSITION');

    const another = await createCard(
      ctx,
      admin.cookie,
      { warehouseId: fx.msk.id },
      'test-version-0001',
    );
    const stale = await transition(
      ctx,
      admin.cookie,
      another.id,
      { action: 'issue', holderId: fx.manager.id, expectedVersion: 99 },
      'test-version-0002',
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as ErrorBody).error.code).toBe('VERSION_CONFLICT');
  });

  it('keeps audit append-only at the database level', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    await createCard(ctx, admin.cookie, { warehouseId: fx.msk.id }, 'test-audit-0001');

    const before = await ctx.db
      .select({ details: operations.details })
      .from(operations)
      .orderBy(sql`id desc`)
      .limit(1);

    await expect(
      ctx.db.execute(
        sql`update operations set details = '{}'::jsonb where id = (select max(id) from operations)`,
      ),
    ).rejects.toThrow();

    const after = await ctx.db
      .select({ details: operations.details })
      .from(operations)
      .orderBy(sql`id desc`)
      .limit(1);

    expect(after).toEqual(before);
  });

  it('writes a durable outbox event with the business change', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const card = await createCard(
      ctx,
      admin.cookie,
      { warehouseId: fx.msk.id },
      'test-outbox-0001',
    );

    const rows = await ctx.db.select().from(outboxEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.processedAt).toBeNull();
    expect((rows[0]?.payload as { type?: string }).type).toBe('card.created');
    expect((rows[0]?.payload as { card?: { id?: string } }).card?.id).toBe(card.id);
  });
});

describe('object-level access', () => {
  it('forbids a manager from reading or touching a foreign card', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const manager = await loginAs(ctx, 'manager', 'manager123');
    const foreign = await createCard(
      ctx,
      admin.cookie,
      { warehouseId: fx.msk.id },
      'test-foreign-0001',
    );

    const read = await request(ctx, 'GET', `/api/cards/${foreign.id}`, {
      cookie: manager.cookie,
    });
    expect(read.status).toBe(403);

    const write = await transition(
      ctx,
      manager.cookie,
      foreign.id,
      { action: 'return' },
      'test-foreign-0002',
    );
    expect(write.status).toBe(403);

    const list = await request(ctx, 'GET', '/api/cards', { cookie: manager.cookie });
    expect(list.status).toBe(200);
    const page = (await list.json()) as { data: Page<CardDto> };
    expect(page.data.items).toHaveLength(0);

    const audit = await request(ctx, 'GET', '/api/audit', { cookie: manager.cookie });
    const auditPage = (await audit.json()) as { data: { items: OperationDto[] } };
    expect(auditPage.data.items).toHaveLength(0);
  });

  it('does not let an owner override the current holder', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const manager = await loginAs(ctx, 'manager', 'manager123');

    const managerRow = await ctx.db
      .select()
      .from(users)
      .where(sql`login = 'manager'`)
      .limit(1);
    const source = managerRow[0];
    if (!source) throw new Error('Manager fixture is missing');

    const secondRows = await ctx.db
      .insert(users)
      .values({
        login: 'manager2',
        passwordHash: source.passwordHash,
        name: 'Второй Менеджер',
        role: 'manager',
        warehouseId: null,
        isActive: true,
      })
      .returning();
    const second = secondRows[0];
    if (!second) throw new Error('Second manager was not created');

    const card = await createCard(
      ctx,
      admin.cookie,
      { warehouseId: fx.msk.id, ownerId: fx.manager.id },
      'test-owner-0001',
    );
    const issued = await transition(
      ctx,
      admin.cookie,
      card.id,
      { action: 'issue', holderId: second.id },
      'test-owner-0002',
    );
    expect(issued.status).toBe(200);

    const detail = await request(ctx, 'GET', `/api/cards/${card.id}`, {
      cookie: manager.cookie,
    });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { data: CardDetailDto }).data.availableActions).toEqual([]);

    const attempt = await transition(
      ctx,
      manager.cookie,
      card.id,
      { action: 'return' },
      'test-owner-0003',
    );
    expect(attempt.status).toBe(403);

    // The actual holder can return the card even though the owner is another
    // manager. The post-update access check must not roll the transaction back.
    const holder = await loginAs(ctx, 'manager2', 'manager123');
    const returned = await transition(
      ctx,
      holder.cookie,
      card.id,
      { action: 'return' },
      'test-owner-0004',
    );
    expect(returned.status).toBe(200);
    const returnedBody = (await returned.json()) as MutationBody<CardDetailDto>;
    expect(returnedBody.data.status).toBe('returned');
    expect(returnedBody.data.holder).toBeNull();

    const afterReturn = await request(ctx, 'GET', `/api/cards/${card.id}`, {
      cookie: holder.cookie,
    });
    expect(afterReturn.status).toBe(403);

    // A saved idempotent response must not bypass the now-revoked scope.
    const replayAfterRevoke = await transition(
      ctx,
      holder.cookie,
      card.id,
      { action: 'return' },
      'test-owner-0004',
    );
    expect(replayAfterRevoke.status).toBe(403);
  });

  it('lets a manager return a card they hold, but not write it off', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const manager = await loginAs(ctx, 'manager', 'manager123');
    const card = await createCard(
      ctx,
      admin.cookie,
      { warehouseId: fx.msk.id },
      'test-return-0001',
    );
    await transition(
      ctx,
      admin.cookie,
      card.id,
      { action: 'issue', holderId: fx.manager.id },
      'test-return-0002',
    );

    const returned = await transition(
      ctx,
      manager.cookie,
      card.id,
      { action: 'return' },
      'test-return-0003',
    );
    expect(returned.status).toBe(200);
    const body = (await returned.json()) as MutationBody<CardDetailDto>;
    expect(body.data.status).toBe('returned');
    expect(body.data.holder).toBeNull();

    const writeOff = await transition(
      ctx,
      manager.cookie,
      card.id,
      { action: 'write_off', reason: 'Попытка менеджера' },
      'test-return-0004',
    );
    expect(writeOff.status).toBe(403);
  });

  it('scopes warehouse staff to their own warehouse', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const warehouse = await loginAs(ctx, 'warehouse', 'warehouse123');
    const manager = await loginAs(ctx, 'manager', 'manager123');

    const foreignWarehouse = await request(ctx, 'POST', '/api/cards', {
      cookie: warehouse.cookie,
      body: { title: 'Не мой склад', warehouseId: fx.spb.id },
      idempotencyKey: 'test-scope-0001',
    });
    expect(foreignWarehouse.status).toBe(403);

    const ownWarehouse = await request(ctx, 'POST', '/api/cards', {
      cookie: warehouse.cookie,
      body: { title: 'Мой склад', warehouseId: fx.msk.id },
      idempotencyKey: 'test-scope-0002',
    });
    expect(ownWarehouse.status).toBe(201);

    const managerCreate = await request(ctx, 'POST', '/api/cards', {
      cookie: manager.cookie,
      body: { title: 'Нельзя', warehouseId: fx.msk.id },
      idempotencyKey: 'test-scope-0003',
    });
    expect(managerCreate.status).toBe(403);

    const spbCard = await createCard(
      ctx,
      admin.cookie,
      { warehouseId: fx.spb.id, title: 'Чужой склад для чтения' },
      'test-scope-0004',
    );
    const foreignRead = await request(ctx, 'GET', `/api/cards/${spbCard.id}`, {
      cookie: warehouse.cookie,
    });
    expect(foreignRead.status).toBe(403);
  });

  it('scopes manager dashboard and scan results', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const manager = await loginAs(ctx, 'manager', 'manager123');
    const own = await createCard(
      ctx,
      admin.cookie,
      { warehouseId: fx.msk.id, title: 'Своя для менеджера' },
      'test-dash-0001',
    );
    await createCard(
      ctx,
      admin.cookie,
      { warehouseId: fx.msk.id, title: 'Чужая' },
      'test-dash-0002',
    );
    await transition(
      ctx,
      admin.cookie,
      own.id,
      { action: 'issue', holderId: fx.manager.id },
      'test-dash-0003',
    );

    const dashboard = await request(ctx, 'GET', '/api/dashboard', {
      cookie: manager.cookie,
    });
    expect(dashboard.status).toBe(200);
    const dashboardBody = (await dashboard.json()) as { data: DashboardDto };
    expect(dashboardBody.data.stats.total).toBe(1);
    expect(dashboardBody.data.stats.issued).toBe(1);
    expect(dashboardBody.data.stats.mine).toBe(1);

    const ownScan = await request(ctx, 'POST', '/api/scan', {
      cookie: manager.cookie,
      body: { code: own.sku },
    });
    expect(ownScan.status).toBe(200);

    const foreign = await ctx.db
      .select()
      .from(cards)
      .where(sql`title = 'Чужая'`);
    const foreignScan = await request(ctx, 'POST', '/api/scan', {
      cookie: manager.cookie,
      body: { code: foreign[0]?.sku ?? 'UNKNOWN' },
    });
    expect(foreignScan.status).toBe(404);

    const adminDashboard = await request(ctx, 'GET', '/api/dashboard', {
      cookie: admin.cookie,
    });
    const adminBody = (await adminDashboard.json()) as { data: DashboardDto };
    expect(adminBody.data.stats.total).toBe(2);
  });
});
