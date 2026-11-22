import { Hono } from 'hono';
import { loginSchema } from '@cardops/shared';
import { AppError } from '../../lib/errors';
import type { AppDeps } from '../../app.deps';
import type { AppContext, AppEnv } from '../context';
import { getPrincipal } from '../context';
import {
  clearAuthCookies,
  readRefreshCookie,
  setAuthCookies,
  setWsTicketCookie,
} from '../auth-cookie';
import { parseJson } from '../validation';
import type { AuthService } from '../../modules/auth/auth.service';
import { signRealtimeTicket } from '../../modules/auth/token';

function clientIp(c: AppContext, trustProxy: boolean): string {
  if (!trustProxy) return 'local';

  // Only the hop appended by our own proxy is trusted. X-Real-IP can be
  // supplied by the client when Vite/nginx is not the one overwriting it.
  const forwarded = c.req.header('x-forwarded-for');
  if (!forwarded) return 'local';
  const hops = forwarded
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.at(-1) ?? 'local';
}

function meta(c: AppContext, deps: AppDeps) {
  return {
    ip: clientIp(c, deps.config.TRUST_PROXY),
    userAgent: c.req.header('user-agent') ?? null,
  };
}

export function authRoutes(deps: AppDeps, service: AuthService): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.post('/login', async (c) => {
    const input = await parseJson(c, loginSchema);
    const windowMs = deps.config.LOGIN_RATE_WINDOW_MINUTES * 60_000;
    const ip = clientIp(c, deps.config.TRUST_PROXY);
    const login = input.login.toLowerCase();
    const loginKey = `login:${ip}:${login}`;

    const [perLogin, perIp, perAccount] = await Promise.all([
      deps.rateLimiter.consume(loginKey, deps.config.LOGIN_RATE_LIMIT, windowMs),
      deps.rateLimiter.consume(`login-ip:${ip}`, deps.config.LOGIN_RATE_LIMIT * 3, windowMs),
      deps.rateLimiter.consume(
        `login-account:${login}`,
        deps.config.LOGIN_RATE_LIMIT * 2,
        windowMs,
      ),
    ]);

    if (!perLogin.allowed || !perIp.allowed || !perAccount.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many login attempts, try again later', {
        retryAfter: Math.max(perLogin.retryAfter, perIp.retryAfter, perAccount.retryAfter),
      });
    }

    const result = await service.login(input, meta(c, deps));
    // Successful login clears all three counters. Otherwise an office NAT or
    // a busy account accumulates successful attempts and locks itself out.
    await Promise.all([
      deps.rateLimiter.reset(loginKey),
      deps.rateLimiter.reset(`login-account:${login}`),
      deps.rateLimiter.reset(`login-ip:${ip}`),
    ]);
    setAuthCookies(c, deps.config, result);

    return c.json({
      data: {
        user: result.user,
        expiresIn: result.expiresInSeconds,
      },
    });
  });

  router.post('/refresh', async (c) => {
    try {
      const result = await service.refresh(readRefreshCookie(c), meta(c, deps));
      setAuthCookies(c, deps.config, result);
      return c.json({
        data: {
          user: result.user,
          expiresIn: result.expiresInSeconds,
        },
      });
    } catch (error) {
      clearAuthCookies(c, deps.config);
      throw error;
    }
  });

  router.get('/me', (c) => {
    return c.json({ data: { user: getPrincipal(c) } });
  });

  router.post('/logout', async (c) => {
    await service.logout(readRefreshCookie(c));
    clearAuthCookies(c, deps.config);
    return c.json({ data: { ok: true } });
  });

  router.post('/realtime-ticket', async (c) => {
    const sid = c.get('sessionId');
    if (!sid) throw AppError.unauthorized('Session context is missing');
    const { ticket, jti } = await signRealtimeTicket(deps.config, getPrincipal(c), sid);
    // Single-use ticket: the notifications service deletes this key atomically
    // on upgrade, so a captured handshake cannot be replayed.
    await deps.redis.set(`cardops:ws:ticket:${jti}`, '1', 'EX', 120);
    setWsTicketCookie(c, deps.config, ticket);
    // The ticket is deliberately not returned in the body: the browser sends
    // the HttpOnly Path=/ws cookie, so the secret never touches JS or access logs.
    return c.json({ data: { expiresIn: 120 } });
  });

  return router;
}
