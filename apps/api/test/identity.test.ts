import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import type { AdminUserDto, UserDto } from '@cardops/shared';
import {
  createTestContext,
  fixtures,
  loginAs,
  request,
  resetAndSeed,
  type Fixtures,
  type TestContext,
} from './helpers';

interface ErrorBody {
  error: { code: string };
}

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

function cookieValue(setCookies: string[], name: string): string | null {
  return setCookies.find((value) => value.startsWith(`${name}=`))?.split(';')[0] ?? null;
}

describe('refresh token rotation', () => {
  it('rotates the refresh token and detects reuse', async () => {
    const login = await loginAs(ctx, 'admin', 'admin123');

    const rotated = await ctx.app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: login.refreshCookie },
    });
    expect(rotated.status).toBe(200);
    const rotatedCookies = rotated.headers.getSetCookie();
    const newAccess = cookieValue(rotatedCookies, 'cardops_session');
    const newRefresh = cookieValue(rotatedCookies, 'cardops_refresh');
    expect(newAccess).toBeTruthy();
    expect(newRefresh).toBeTruthy();
    expect(newAccess).not.toBe(login.cookie);

    const me = await request(ctx, 'GET', '/api/auth/me', { cookie: newAccess! });
    expect(me.status).toBe(200);

    // Reusing the old token must revoke the whole family.
    const replay = await ctx.app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: login.refreshCookie },
    });
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as ErrorBody).error.code).toBe('UNAUTHORIZED');

    const afterReuse = await request(ctx, 'GET', '/api/auth/me', { cookie: newAccess! });
    expect(afterReuse.status).toBe(401);
  });

  it('revokes sessions through logout and admin action', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const manager = await loginAs(ctx, 'manager', 'manager123');

    const logout = await ctx.app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: manager.refreshCookie },
    });
    expect(logout.status).toBe(200);
    const afterLogout = await request(ctx, 'GET', '/api/auth/me', { cookie: manager.cookie });
    expect(afterLogout.status).toBe(401);

    const freshManager = await loginAs(ctx, 'manager', 'manager123');
    const revoke = await request(ctx, 'POST', `/api/admin/users/${fx.manager.id}/revoke-sessions`, {
      cookie: admin.cookie,
    });
    expect(revoke.status).toBe(200);
    const afterRevoke = await request(ctx, 'GET', '/api/auth/me', {
      cookie: freshManager.cookie,
    });
    expect(afterRevoke.status).toBe(401);
  });
});

describe('security hardening', () => {
  it('rejects a cross-site mutation origin', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const response = await request(ctx, 'POST', '/api/cards', {
      cookie: admin.cookie,
      body: { title: 'CSRF', warehouseId: fx.msk.id, last4: '4242' },
      idempotencyKey: 'csrf-origin-1',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).error.code).toBe('INVALID_ORIGIN');
  });

  it('delivers the WS ticket only as a short-lived HttpOnly cookie', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const response = await request(ctx, 'POST', '/api/auth/realtime-ticket', {
      cookie: admin.cookie,
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data.ticket).toBeUndefined();

    const setCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('cardops_ws_ticket='));
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/ws/i);
    expect(setCookie).toMatch(/Max-Age=120/i);

    const token = setCookie!.split(';')[0]!.slice('cardops_ws_ticket='.length);
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(ctx.deps.config.JWT_SECRET),
      {
        issuer: 'cardops',
        audience: 'cardops-ws',
        algorithms: ['HS256'],
      },
    );
    expect(typeof payload.sid).toBe('string');
    expect(typeof payload.jti).toBe('string');
    // The ticket is bound to the live Redis session, so revocation wins even
    // inside the two-minute ticket window.
    expect(await ctx.redis.exists(`cardops:session:${payload.sid as string}`)).toBe(1);
    // Single-use: notifications deletes this key atomically on upgrade.
    expect(await ctx.redis.get(`cardops:ws:ticket:${payload.jti as string}`)).toBe('1');
  });
});

describe('admin user CRUD', () => {
  it('prevents self-lockout and removing the last active admin', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');
    const me = admin.user;

    const demoteSelf = await request(ctx, 'PATCH', `/api/admin/users/${me.id}`, {
      cookie: admin.cookie,
      body: { role: 'manager' },
    });
    expect(demoteSelf.status).toBe(409);

    const deactivateSelf = await request(ctx, 'PATCH', `/api/admin/users/${me.id}`, {
      cookie: admin.cookie,
      body: { isActive: false },
    });
    expect(deactivateSelf.status).toBe(409);

    const stillAdmin = await request(ctx, 'GET', '/api/auth/me', { cookie: admin.cookie });
    expect(stillAdmin.status).toBe(200);
  });

  it('creates, updates, deactivates and revokes a user', async () => {
    const admin = await loginAs(ctx, 'admin', 'admin123');

    const created = await request(ctx, 'POST', '/api/admin/users', {
      cookie: admin.cookie,
      body: {
        login: 'agent2',
        password: 'agent12345',
        name: 'Новый Агент',
        role: 'manager',
        warehouseId: null,
      },
    });
    expect(created.status).toBe(201);
    const createdUser = ((await created.json()) as { data: AdminUserDto }).data;
    expect(createdUser.role).toBe('manager');

    const agent = await loginAs(ctx, 'agent2', 'agent12345');
    expect(agent.user.name).toBe('Новый Агент');

    const updated = await request(ctx, 'PATCH', `/api/admin/users/${createdUser.id}`, {
      cookie: admin.cookie,
      body: { name: 'Агент Обновлённый', role: 'manager' },
    });
    expect(updated.status).toBe(200);

    const meUpdated = await request(ctx, 'GET', '/api/auth/me', { cookie: agent.cookie });
    const meBody = (await meUpdated.json()) as { data: { user: UserDto } };
    expect(meBody.data.user.name).toBe('Агент Обновлённый');

    const deactivated = await request(ctx, 'PATCH', `/api/admin/users/${createdUser.id}`, {
      cookie: admin.cookie,
      body: { isActive: false },
    });
    expect(deactivated.status).toBe(200);

    const afterDeactivate = await request(ctx, 'GET', '/api/auth/me', {
      cookie: agent.cookie,
    });
    expect(afterDeactivate.status).toBe(401);

    const loginDisabled = await request(ctx, 'POST', '/api/auth/login', {
      body: { login: 'agent2', password: 'agent12345' },
    });
    expect(loginDisabled.status).toBe(401);
  });
});
