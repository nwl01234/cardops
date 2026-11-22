import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import type { AppDeps } from '../app.deps';
import type { AppEnv } from './context';
import { handleError } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import { originGuard } from './middleware/origin-guard';
import { requestContextMiddleware } from './middleware/request-context';
import { authRoutes } from './routes/auth.routes';
import { adminUserRoutes } from './routes/admin-users.routes';
import { cardRoutes } from './routes/cards.routes';
import { auditRoutes } from './routes/audit.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { scanRoutes } from './routes/scan.routes';
import { directoryRoutes } from './routes/directory.routes';
import { systemRoutes } from './routes/system.routes';
import { AuthService } from '../modules/auth/auth.service';
import { CardsService } from '../modules/cards/cards.service';
import { AuditService } from '../modules/audit/audit.service';
import { DashboardService } from '../modules/dashboard/dashboard.service';
import { UsersService } from '../modules/users/users.service';
import { metricsResponse } from './observability/metrics';

const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  // Logout only clears the cookie. It must work even when the token already
  // expired, otherwise the SPA cannot recover from a stale session.
  '/api/auth/logout',
  '/api/health',
]);

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const authService = new AuthService(deps.db, deps.config, deps.sessions);
  const cardsService = new CardsService(deps.db, deps.outbox);
  const auditService = new AuditService(deps.db);
  const dashboardService = new DashboardService(deps.db);
  const usersService = new UsersService(deps.db, authService);

  app.use('*', secureHeaders());
  app.use(
    '/api/*',
    cors({
      origin: deps.config.WEB_ORIGIN,
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use('*', requestContextMiddleware(deps.logger, deps.redis));
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) =>
        c.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request body exceeds 64 KB',
              requestId: 'body-limit',
            },
          },
          413,
        ),
    }),
  );
  app.use('/api/*', originGuard(deps.config));
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'OPTIONS' || PUBLIC_API_PATHS.has(c.req.path)) {
      await next();
      return;
    }
    return authMiddleware(deps)(c, next);
  });

  app.get('/api/health', async (c) => {
    try {
      await deps.db.execute(sql`select 1`);
      return c.json({ data: { status: 'ok' } });
    } catch {
      return c.json({ data: { status: 'unavailable' } }, 503);
    }
  });

  app.route('/api/auth', authRoutes(deps, authService));
  app.route('/api/admin/users', adminUserRoutes(deps, usersService));
  app.route('/api/cards', cardRoutes(deps, cardsService));
  app.route('/api/audit', auditRoutes(deps, auditService));
  app.route('/api/dashboard', dashboardRoutes(deps, dashboardService));
  app.route('/api/scan', scanRoutes(deps, cardsService));
  app.route('/api', directoryRoutes(deps));
  app.route('/api/system', systemRoutes(deps));

  // Local Prometheus scrape target. In production keep it on the private
  // network or put it behind the ingress allowlist.
  app.get('/metrics', (c) => metricsResponse(deps, c));

  app.notFound((c) => {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
          requestId: c.get('requestId') ?? 'unknown',
        },
      },
      404,
    );
  });

  app.onError((error, c) => handleError(error, c, deps.logger));

  return app;
}
