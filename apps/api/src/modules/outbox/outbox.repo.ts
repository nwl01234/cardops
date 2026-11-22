import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lte, min, sql } from 'drizzle-orm';
import type { OutboxStatsDto, RealtimeEvent } from '@cardops/shared';
import type { Database, DbExecutor } from '../../db/client';
import { outboxEvents } from '../../db/schema';

export type RealtimePayload = Omit<RealtimeEvent, 'id'>;

export interface OutboxEventRow {
  id: number;
  topic: string;
  eventType: string;
  payload: RealtimePayload;
  attempts: number;
}

export async function insertOutboxEvent(tx: DbExecutor, event: RealtimePayload): Promise<void> {
  await tx.insert(outboxEvents).values({
    topic: 'realtime.dashboard',
    eventType: event.type,
    payload: event as unknown as Record<string, unknown>,
    occurredAt: new Date(event.occurredAt),
  });
}

/**
 * Lease a batch of pending events. The row is not marked processed here:
 * publishing happens after this transaction commits, and a crash leaves the
 * event eligible again after the lease expires (at-least-once delivery).
 */
export async function leaseOutboxBatch(
  db: Database,
  limit: number,
  leaseSeconds: number,
): Promise<OutboxEventRow[]> {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: outboxEvents.id,
        topic: outboxEvents.topic,
        eventType: outboxEvents.eventType,
        payload: outboxEvents.payload,
        attempts: outboxEvents.attempts,
      })
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.processedAt), lte(outboxEvents.availableAt, new Date())))
      .orderBy(outboxEvents.id)
      .limit(limit)
      .for('update', { skipLocked: true });

    if (candidates.length === 0) return [];

    const ids = candidates.map((row) => row.id);
    await tx
      .update(outboxEvents)
      .set({
        attempts: sql`${outboxEvents.attempts} + 1`,
        availableAt: sql`now() + (${leaseSeconds} * interval '1 second')`,
      })
      .where(inArray(outboxEvents.id, ids));

    return candidates.map((row) => ({
      id: row.id,
      topic: row.topic,
      eventType: row.eventType,
      payload: row.payload as RealtimePayload,
      attempts: row.attempts + 1,
    }));
  });
}

export async function markOutboxProcessed(db: Database, id: number): Promise<void> {
  await db
    .update(outboxEvents)
    .set({ processedAt: new Date(), lastError: null })
    .where(eq(outboxEvents.id, id));
}

export async function markOutboxFailed(
  db: Database,
  id: number,
  error: string,
  backoffSeconds: number,
): Promise<void> {
  await db
    .update(outboxEvents)
    .set({
      lastError: error.slice(0, 500),
      availableAt: sql`now() + (${backoffSeconds} * interval '1 second')`,
    })
    .where(eq(outboxEvents.id, id));
}

export async function getOutboxStats(db: Database): Promise<OutboxStatsDto> {
  const [pendingRows, processedRows, failedRows, deadRows, oldestRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.processedAt), isNull(outboxEvents.deadLetteredAt))),
    db
      .select({ value: count() })
      .from(outboxEvents)
      .where(sql`${outboxEvents.processedAt} > now() - interval '1 hour'`),
    db
      .select({ value: count() })
      .from(outboxEvents)
      .where(
        and(
          isNull(outboxEvents.processedAt),
          isNull(outboxEvents.deadLetteredAt),
          isNotNull(outboxEvents.lastError),
          gte(outboxEvents.attempts, 5),
        ),
      ),
    db
      .select({ value: count() })
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.processedAt), isNotNull(outboxEvents.deadLetteredAt))),
    db
      .select({ value: min(outboxEvents.occurredAt) })
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.processedAt), isNull(outboxEvents.deadLetteredAt))),
  ]);

  const oldest = oldestRows[0]?.value ?? null;
  const lagSeconds = oldest ? Math.floor((Date.now() - oldest.getTime()) / 1000) : 0;

  return {
    pending: Number(pendingRows[0]?.value ?? 0),
    processedLastHour: Number(processedRows[0]?.value ?? 0),
    failed: Number(failedRows[0]?.value ?? 0),
    deadLettered: Number(deadRows[0]?.value ?? 0),
    oldestPendingAt: oldest?.toISOString() ?? null,
    lagSeconds,
  };
}

export async function replayDeadLetters(db: Database): Promise<number> {
  const rows = await db
    .update(outboxEvents)
    .set({
      processedAt: null,
      deadLetteredAt: null,
      attempts: 0,
      lastError: null,
      availableAt: new Date(),
    })
    .where(isNotNull(outboxEvents.deadLetteredAt))
    .returning({ id: outboxEvents.id });
  return rows.length;
}

export async function recentOutboxEvents(db: Database, limit: number) {
  return db
    .select({
      id: outboxEvents.id,
      eventType: outboxEvents.eventType,
      attempts: outboxEvents.attempts,
      occurredAt: outboxEvents.occurredAt,
      processedAt: outboxEvents.processedAt,
      deadLetteredAt: outboxEvents.deadLetteredAt,
      lastError: outboxEvents.lastError,
    })
    .from(outboxEvents)
    .orderBy(desc(outboxEvents.id))
    .limit(limit);
}
