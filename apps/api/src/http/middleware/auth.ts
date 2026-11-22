import type { Capability } from '@cardops/shared';
import { can } from '@cardops/shared';
import { AppError } from '../../lib/errors';
import { findUserById, type UserRecord } from '../../modules/users/users.repo';
import type { AppConfig } from '../../config/env';
import type { Database } from '../../db/client';
import type { AppMiddleware, AppContext, Principal } from '../context';
import { readAccessToken } from '../../modules/auth/token';
import { readSessionCookie } from '../auth-cookie';
import type { SessionStore } from '../../modules/auth/session-store';

interface AuthDeps {
  db: Database;
  config: AppConfig;
  sessions: SessionStore;
}

export function toPrincipal(user: UserRecord): Principal {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role,
    warehouseId: user.warehouseId,
    warehouseName: user.warehouseName,
  };
}

function extractToken(c: AppContext, allowQueryToken: boolean): string | undefined {
  const authorization = c.req.header('authorization');
  const bearer = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : undefined;

  return bearer ?? readSessionCookie(c) ?? (allowQueryToken ? c.req.query('token') : undefined);
}

/**
 * JWT answers "who is this". The role and warehouse scope are re-read from the
 * database on every request, so deactivating a user or changing a role takes
 * effect immediately rather than when the token expires.
 */
export function authMiddleware(
  deps: AuthDeps,
  options: { allowQueryToken?: boolean } = {},
): AppMiddleware {
  return async (c, next) => {
    const token = extractToken(c, options.allowQueryToken ?? false);
    if (!token) throw AppError.unauthorized();

    const claims = await readAccessToken(deps.config, token);
    if (!(await deps.sessions.isActive(claims.sid))) {
      throw AppError.unauthorized('Session has been revoked');
    }
    const user = await findUserById(deps.db, claims.sub);
    if (!user || !user.isActive) {
      throw AppError.unauthorized('Session is no longer valid');
    }

    c.set('principal', toPrincipal(user));
    c.set('tokenExpiresAt', claims.expiresAt);
    c.set('sessionId', claims.sid);
    await next();
  };
}

export function requireCapability(capability: Capability): AppMiddleware {
  return async (c, next) => {
    const principal = c.get('principal');
    if (!can(principal.role, capability)) {
      throw AppError.forbidden(`Role "${principal.role}" cannot perform "${capability}"`);
    }
    await next();
  };
}
