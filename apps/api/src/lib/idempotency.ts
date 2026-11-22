import { and, eq } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import { idempotencyKeys } from '../db/schema';
import { AppError } from './errors';
import { stableHash } from './hash';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export interface IdempotentRequest {
  userId: string;
  endpoint: string;
  key: string;
  payload: unknown;
}

export interface HandlerResult<T> {
  status: number;
  data: T;
}

export interface IdempotentOutcome<T> extends HandlerResult<T> {
  replayed: boolean;
}

/**
 * Runs `handler` exactly once per (user, endpoint, key).
 *
 * The key row, the business change and the audit/outbox rows share one
 * transaction. A duplicate request that arrives concurrently waits on the
 * unique index, then replays the stored response instead of applying the
 * change twice. A failed handler rolls the key back, so the client may retry.
 */
export async function runIdempotent<T>(
  db: Database,
  request: IdempotentRequest,
  handler: (tx: Transaction) => Promise<HandlerResult<T>>,
): Promise<IdempotentOutcome<T>> {
  const requestHash = stableHash(request.payload);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(idempotencyKeys)
      .values({
        userId: request.userId,
        endpoint: request.endpoint,
        key: request.key,
        requestHash,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });

    const reserved = inserted[0];

    if (reserved) {
      const result = await handler(tx);
      await tx
        .update(idempotencyKeys)
        .set({
          status: 'completed',
          responseStatus: result.status,
          responseBody: result.data,
          completedAt: new Date(),
        })
        .where(eq(idempotencyKeys.id, reserved.id));
      return { ...result, replayed: false };
    }

    const existing = await tx
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, request.userId),
          eq(idempotencyKeys.endpoint, request.endpoint),
          eq(idempotencyKeys.key, request.key),
        ),
      )
      .for('update');

    const row = existing[0];
    if (!row) {
      throw new AppError('CONFLICT', 'Idempotency key state is inconsistent; retry the request');
    }
    if (row.requestHash !== requestHash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_MISMATCH',
        'This Idempotency-Key was already used with a different request payload',
      );
    }
    if (row.status !== 'completed' || row.responseBody === null) {
      throw new AppError(
        'IDEMPOTENCY_IN_PROGRESS',
        'A request with this Idempotency-Key is still in progress',
      );
    }

    return {
      status: row.responseStatus ?? 200,
      data: row.responseBody as T,
      replayed: true,
    };
  });
}
