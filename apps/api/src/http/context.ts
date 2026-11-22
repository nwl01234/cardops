import type { Context, MiddlewareHandler } from 'hono';

export interface Principal {
  id: string;
  login: string;
  name: string;
  role: 'admin' | 'manager' | 'warehouse';
  warehouseId: string | null;
  warehouseName: string | null;
}

export interface AppEnv {
  Variables: {
    principal: Principal;
    requestId: string;
    tokenExpiresAt?: number;
    sessionId?: string;
  };
}

export type AppContext = Context<AppEnv>;

export type AppMiddleware = MiddlewareHandler<AppEnv>;

export function getPrincipal(c: Context<AppEnv>): Principal {
  const principal = c.get('principal');
  if (!principal) throw new Error('Principal is not set; auth middleware is misconfigured');
  return principal;
}
