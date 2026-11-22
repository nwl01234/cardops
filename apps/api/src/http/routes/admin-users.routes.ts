import { Hono } from 'hono';
import { z } from 'zod';
import { adminCreateUserSchema, adminUpdateUserSchema } from '@cardops/shared';
import type { AppDeps } from '../../app.deps';
import type { AppEnv } from '../context';
import { getPrincipal } from '../context';
import { parseJson, parseParam } from '../validation';
import { requireCapability } from '../middleware/auth';
import { sendData } from '../respond';
import type { UsersService } from '../../modules/users/users.service';

const userIdSchema = z.uuid('User id must be a UUID');

export function adminUserRoutes(_deps: AppDeps, service: UsersService): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', requireCapability('user.manage'), async (c) => {
    return sendData(c, await service.list());
  });

  router.post('/', requireCapability('user.manage'), async (c) => {
    const input = await parseJson(c, adminCreateUserSchema);
    return sendData(c, await service.create(input), 201);
  });

  router.patch('/:id', requireCapability('user.manage'), async (c) => {
    const id = parseParam(c, 'id', userIdSchema);
    const input = await parseJson(c, adminUpdateUserSchema);
    const actor = getPrincipal(c);
    return sendData(c, await service.update(actor.id, id, input));
  });

  router.post('/:id/revoke-sessions', requireCapability('user.manage'), async (c) => {
    const id = parseParam(c, 'id', userIdSchema);
    await service.revokeSessions(id);
    return sendData(c, { ok: true });
  });

  return router;
}
