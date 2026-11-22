import postgres from 'postgres';
import Redis from 'ioredis';
import { connect, type JetStreamClient, type NatsConnection } from 'nats';
import pino from 'pino';
import { loadConfig } from './env';

interface OutboxRow {
  id: number;
  topic: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, base: { service: 'outbox-worker' } });
const sql = postgres(config.DATABASE_URL, { max: 2, onnotice: () => undefined });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });

let nats: NatsConnection | null = null;
let js: JetStreamClient | null = null;
let connecting = false;
let stopped = false;
let running = false;
let timer: NodeJS.Timeout | null = null;

const STREAM = 'CARDOPS';
const SUBJECT = 'cardops.events';
const MAX_ATTEMPTS = 10;
const STREAM_MAX_AGE_NS = 7 * 24 * 60 * 60 * 1_000_000_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function publish(event: unknown): Promise<void> {
  if (!nats || nats.isClosed() || !js) throw new Error('NATS JetStream is not connected');
  const id = (event as { id?: string }).id;
  const data = new TextEncoder().encode(JSON.stringify(event));
  // JetStream PubAck is durable storage confirmation, not subscriber delivery.
  // Notifications has a durable consumer with explicit ack, so an offline
  // subscriber gets redelivery instead of losing the event.
  await withTimeout(
    js.publish(SUBJECT, data, { msgID: id, timeout: 5_000 }),
    6_000,
    'JetStream publish',
  );
}

async function markProcessed(id: number): Promise<void> {
  await sql`update outbox_events set processed_at = now(), last_error = null where id = ${id}`;
}

async function markFailed(id: number, error: unknown, attempts: number): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  if (attempts >= MAX_ATTEMPTS) {
    await sql`
      update outbox_events
      set last_error = ${message.slice(0, 500)},
          dead_lettered_at = now()
      where id = ${id}
    `;
    return;
  }
  const backoff = Math.min(60, 2 ** Math.min(attempts, 6));
  await sql`
    update outbox_events
    set last_error = ${message.slice(0, 500)},
        available_at = now() + (${backoff} * interval '1 second')
    where id = ${id}
  `;
}

async function dispatch(): Promise<number> {
  if (stopped || running) return 0;
  running = true;
  let published = 0;
  try {
    const rows = await sql<OutboxRow[]>`
      with candidates as (
        select id from outbox_events
        where processed_at is null
          and dead_lettered_at is null
          and available_at <= now()
        order by id
        limit 50
        for update skip locked
      )
      update outbox_events o
      set attempts = o.attempts + 1,
          available_at = now() + interval '30 seconds'
      from candidates c
      where o.id = c.id
      returning o.id, o.topic, o.event_type, o.payload, o.attempts
    `;

    for (const row of rows) {
      const event = { id: String(row.id), ...row.payload };
      try {
        await publish(event);
        await markProcessed(row.id);
        published += 1;
        await redis.set('cardops:worker:last_event', String(row.id));
        await redis.set('cardops:worker:last_event_at', new Date().toISOString());
      } catch (error) {
        await markFailed(row.id, error, row.attempts);
        const deadLettered = row.attempts >= MAX_ATTEMPTS;
        logger.warn(
          { err: error, eventId: row.id, deadLettered },
          deadLettered ? 'Outbox event dead-lettered' : 'Outbox event failed; retry scheduled',
        );
        if (!nats || nats.isClosed()) void connectNats();
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Outbox dispatch cycle failed');
  } finally {
    running = false;
  }
  return published;
}

async function connectNats(): Promise<void> {
  if (connecting) return;
  connecting = true;
  try {
    nats = await connect({
      servers: config.NATS_URL,
      name: 'cardops-outbox-worker',
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 1_000,
    });
    const jsm = await nats.jetstreamManager();
    try {
      await jsm.streams.info(STREAM);
    } catch {
      await jsm.streams.add({
        name: STREAM,
        subjects: [SUBJECT],
        max_age: STREAM_MAX_AGE_NS,
      });
      logger.info({ stream: STREAM }, 'JetStream stream created');
    }
    js = nats.jetstream();
    await redis.set('cardops:infra:nats', 'up', 'EX', 15);
    logger.info({ nats: config.NATS_URL, stream: STREAM }, 'Outbox worker connected to JetStream');
  } catch (error) {
    nats = null;
    js = null;
    await redis.set('cardops:infra:nats', 'down', 'EX', 15).catch(() => undefined);
    logger.error({ err: error }, 'NATS unavailable; retrying');
    setTimeout(() => void connectNats(), 2_000);
  } finally {
    connecting = false;
  }
}

await connectNats();

const wakeSub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
await wakeSub.subscribe('cardops.outbox.wake');
wakeSub.on('message', () => void dispatch());

timer = setInterval(() => {
  if (!nats || nats.isClosed()) void connectNats();
  void redis
    .multi()
    .set('cardops:worker:heartbeat', new Date().toISOString(), 'EX', 15)
    .set('cardops:infra:nats', nats && !nats.isClosed() ? 'up' : 'down', 'EX', 15)
    .exec()
    .catch(() => undefined);
  void dispatch();
}, config.WORKER_POLL_MS);
timer.unref();

await redis
  .multi()
  .set('cardops:worker:started_at', new Date().toISOString())
  .set('cardops:worker:heartbeat', new Date().toISOString(), 'EX', 15)
  .exec()
  .catch(() => undefined);

void dispatch();

async function shutdown(signal: string): Promise<void> {
  if (stopped) return;
  stopped = true;
  logger.info({ signal }, 'Shutting down outbox worker');
  if (timer) clearInterval(timer);
  await nats?.drain().catch(() => undefined);
  wakeSub.disconnect();
  redis.disconnect();
  await sql.end({ timeout: 3 });
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
