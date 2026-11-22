import { Hono } from 'hono';
import { cardListQuerySchema, transitionSchema, createCardSchema } from '@cardops/shared';
import { z } from 'zod';
import type { AppDeps } from '../../app.deps';
import type { AppEnv } from '../context';
import { getPrincipal } from '../context';
import { parseJson, parseParam, parseQuery } from '../validation';
import { requireCapability } from '../middleware/auth';
import { requireIdempotencyKey, sendData, sendMutation } from '../respond';
import type { CardsService } from '../../modules/cards/cards.service';

const cardIdSchema = z.uuid('Card id must be a UUID');

export function cardRoutes(_deps: AppDeps, service: CardsService): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', async (c) => {
    const query = parseQuery(c, cardListQuerySchema);
    const page = await service.list(getPrincipal(c), query);
    return sendData(c, page);
  });

  router.post('/', requireCapability('card.create'), async (c) => {
    const key = requireIdempotencyKey(c);
    const input = await parseJson(c, createCardSchema);
    const outcome = await service.create(getPrincipal(c), input, {
      requestId: c.get('requestId'),
      idempotencyKey: key,
    });
    return sendMutation(c, outcome, key);
  });

  router.get('/:id', async (c) => {
    const id = parseParam(c, 'id', cardIdSchema);
    const card = await service.detail(getPrincipal(c), id);
    return sendData(c, card);
  });

  router.post('/:id/transitions', async (c) => {
    const id = parseParam(c, 'id', cardIdSchema);
    const key = requireIdempotencyKey(c);
    const input = await parseJson(c, transitionSchema);

    const outcome = await service.transition(getPrincipal(c), id, input, {
      requestId: c.get('requestId'),
      idempotencyKey: key,
    });
    return sendMutation(c, outcome, key);
  });

  return router;
}
