import { Hono } from 'hono';
import { scanRequestSchema } from '@cardops/shared';
import type { AppDeps } from '../../app.deps';
import type { AppEnv } from '../context';
import { getPrincipal } from '../context';
import { parseJson } from '../validation';
import { sendData } from '../respond';
import type { CardsService } from '../../modules/cards/cards.service';

export function scanRoutes(_deps: AppDeps, service: CardsService): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.post('/', async (c) => {
    const input = await parseJson(c, scanRequestSchema);
    const card = await service.scan(getPrincipal(c), input);
    return sendData(c, card);
  });

  return router;
}
