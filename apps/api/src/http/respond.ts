import type { MutationMeta, MutationResult } from '@cardops/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { IdempotentOutcome } from '../lib/idempotency';
import { AppError } from '../lib/errors';
import type { AppContext } from './context';
import { IDEMPOTENCY_KEY_PATTERN } from '../lib/idempotency';

export function sendData<T>(c: AppContext, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ data }, status);
}

export function sendMutation<T>(
  c: AppContext,
  outcome: IdempotentOutcome<T>,
  idempotencyKey: string,
) {
  const meta: MutationMeta = {
    requestId: c.get('requestId'),
    idempotencyKey,
    replayed: outcome.replayed,
  };
  const body: MutationResult<T> = { data: outcome.data, meta };
  return c.json(body, outcome.status as ContentfulStatusCode);
}

export function requireIdempotencyKey(c: AppContext): string {
  const key = c.req.header('idempotency-key');
  if (!key) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'This endpoint requires an Idempotency-Key header (8-128 chars: A-Z a-z 0-9 . _ : -)',
    );
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw AppError.validation([
      {
        path: 'Idempotency-Key',
        message: 'Must be 8-128 characters: letters, digits, dot, underscore, colon, dash',
      },
    ]);
  }
  return key;
}
