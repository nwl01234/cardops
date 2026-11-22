import { Hono } from 'hono';
import type { AppDeps } from '../../app.deps';
import type { AppEnv } from '../context';
import { getPrincipal } from '../context';
import { requireCapability } from '../middleware/auth';
import { sendData } from '../respond';
import type { DashboardService } from '../../modules/dashboard/dashboard.service';

export function dashboardRoutes(_deps: AppDeps, service: DashboardService): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', requireCapability('dashboard.read'), async (c) => {
    const dashboard = await service.get(getPrincipal(c));
    return sendData(c, dashboard);
  });

  return router;
}
