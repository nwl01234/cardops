import { AppError } from '../../lib/errors';
import type { AppConfig } from '../../config/env';
import type { AppMiddleware } from '../context';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Cookie auth needs CSRF protection. SameSite=Lax already blocks cross-site
 * POSTs; this Origin check is the second, explicit line. Non-browser clients
 * (no Origin header) can still use Bearer tokens.
 */
export function originGuard(config: AppConfig): AppMiddleware {
  const allowed = new Set([config.WEB_ORIGIN]);

  // localhost and 127.0.0.1 are different origins for the browser. Demo
  // deployments are commonly opened through either one.
  try {
    const web = new URL(config.WEB_ORIGIN);
    if (web.hostname === 'localhost') {
      allowed.add(`${web.protocol}//127.0.0.1${web.port ? `:${web.port}` : ''}`);
    } else if (web.hostname === '127.0.0.1') {
      allowed.add(`${web.protocol}//localhost${web.port ? `:${web.port}` : ''}`);
    }
  } catch {
    // Configuration is validated on boot; this branch is unreachable in practice.
  }

  if (!config.isProduction) {
    allowed.add('http://localhost:5173');
    allowed.add('http://127.0.0.1:5173');
  }

  return async (c, next) => {
    if (UNSAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && !allowed.has(origin)) {
        throw new AppError('INVALID_ORIGIN', 'Request origin is not allowed');
      }
    }
    await next();
  };
}
