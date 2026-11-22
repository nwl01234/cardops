import { requestId as newRequestId } from '../../lib/ids';
import type { AppLogger } from '../../lib/logger';
import type { RedisClient } from '../../lib/redis';
import type { AppMiddleware, Principal } from '../context';
import { observeRequest } from '../observability/metrics';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export function requestContextMiddleware(logger: AppLogger, redis: RedisClient): AppMiddleware {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const id = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : newRequestId();
    c.set('requestId', id);
    c.header('x-request-id', id);

    const startedAt = performance.now();
    try {
      await next();
    } finally {
      const principal = c.get('principal') as Principal | undefined;
      const entry = {
        requestId: id,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - startedAt),
        userId: principal?.id,
        role: principal?.role,
      };

      if (c.req.method === 'GET') {
        logger.debug(entry, 'http.request');
      } else {
        logger.info(entry, 'http.request');
      }

      void observeRequest(c, entry.durationMs);

      void redis
        .multi()
        .lpush(
          'cardops:traces',
          JSON.stringify({
            traceId: id,
            service: 'core',
            operation: `${c.req.method} ${c.req.path}`,
            durationMs: entry.durationMs,
            status: String(entry.status),
            at: new Date().toISOString(),
          }),
        )
        .ltrim('cardops:traces', 0, 199)
        .exec()
        .catch(() => undefined);
    }
  };
}
