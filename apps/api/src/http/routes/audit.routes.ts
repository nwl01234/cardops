import { Hono } from 'hono';
import { auditQuerySchema } from '@cardops/shared';
import type { AppDeps } from '../../app.deps';
import type { AppEnv } from '../context';
import { getPrincipal } from '../context';
import { requireCapability } from '../middleware/auth';
import { parseQuery } from '../validation';
import { sendData } from '../respond';
import type { AuditService } from '../../modules/audit/audit.service';

export function auditRoutes(_deps: AppDeps, service: AuditService): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', requireCapability('audit.read'), async (c) => {
    const query = parseQuery(c, auditQuerySchema);
    const page = await service.list(getPrincipal(c), query);
    return sendData(c, page);
  });

  return router;
}
