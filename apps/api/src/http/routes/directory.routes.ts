import { Hono } from 'hono';
import { userListQuerySchema } from '@cardops/shared';
import type { AppDeps } from '../../app.deps';
import type { AppEnv } from '../context';
import { getPrincipal } from '../context';
import { requireCapability } from '../middleware/auth';
import { AppError } from '../../lib/errors';
import { parseQuery } from '../validation';
import { sendData } from '../respond';
import { listWarehouses } from '../../modules/warehouses/warehouses.repo';
import { listActiveUsersByRole } from '../../modules/users/users.repo';

export function directoryRoutes(deps: AppDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/warehouses', requireCapability('warehouse.list'), async (c) => {
    const principal = getPrincipal(c);
    const warehouses = await listWarehouses(deps.db);
    return sendData(
      c,
      principal.role === 'warehouse'
        ? warehouses.filter((warehouse) => warehouse.id === principal.warehouseId)
        : warehouses,
    );
  });

  router.get('/users', requireCapability('user.list'), async (c) => {
    const principal = getPrincipal(c);
    const query = parseQuery(c, userListQuerySchema);

    // A warehouse worker needs managers to issue cards, not the admin
    // directory. This also removes one path to admin UUID enumeration.
    if (principal.role === 'warehouse' && query.role !== 'manager') {
      throw AppError.forbidden('Warehouse staff may only list managers');
    }

    return sendData(c, await listActiveUsersByRole(deps.db, query.role));
  });

  return router;
}
