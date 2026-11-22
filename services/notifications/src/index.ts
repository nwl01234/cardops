import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { jwtVerify } from 'jose';
import Redis from 'ioredis';
import { connect, type NatsConnection } from 'nats';
import pino from 'pino';
import type { RealtimeEvent } from '@cardops/shared';
import { loadConfig } from './env';
import { NotificationHub } from './hub';
import type { RealtimePrincipal } from './visibility';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, base: { service: 'notifications' } });
const hub = new NotificationHub((delta) => {
  void redis.hincrby('cardops:ws:clients', config.INSTANCE_ID, delta).catch(() => undefined);
});

const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  lazyConnect: false,
});
const redisSub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });

let nats: NatsConnection | null = null;
let stopped = false;

function tokenFromRequest(cookieHeader: string | undefined): string | undefined {
  return (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('cardops_ws_ticket='))
    ?.slice('cardops_ws_ticket='.length);
}

function allowedOrigins(): Set<string> {
  const allowed = new Set([config.WEB_ORIGIN]);
  try {
    const web = new URL(config.WEB_ORIGIN);
    if (web.hostname === 'localhost') {
      allowed.add(`${web.protocol}//127.0.0.1${web.port ? `:${web.port}` : ''}`);
    } else if (web.hostname === '127.0.0.1') {
      allowed.add(`${web.protocol}//localhost${web.port ? `:${web.port}` : ''}`);
    }
  } catch {
    // Already validated by the config schema.
  }
  return allowed;
}

const ORIGINS = allowedOrigins();

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return config.NODE_ENV !== 'production';
  return ORIGINS.has(origin);
}

async function principalFromToken(token: string | undefined): Promise<RealtimePrincipal> {
  if (!token) throw new Error('missing ticket');
  const { payload } = await jwtVerify(token, new TextEncoder().encode(config.JWT_SECRET), {
    issuer: 'cardops',
    audience: 'cardops-ws',
    algorithms: ['HS256'],
  });
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.login !== 'string' ||
    typeof payload.name !== 'string' ||
    typeof payload.sid !== 'string' ||
    typeof payload.jti !== 'string' ||
    (payload.role !== 'admin' && payload.role !== 'manager' && payload.role !== 'warehouse')
  ) {
    throw new Error('malformed ticket');
  }
  // Atomic single-use check. A replayed handshake (same jti) gets nothing.
  if ((await redis.del(`cardops:ws:ticket:${payload.jti}`)) !== 1) {
    throw new Error('ticket already used');
  }
  // A two-minute ticket must not outlive an admin/logout revocation.
  if (!(await redis.exists(`cardops:session:${payload.sid}`))) {
    throw new Error('revoked session');
  }
  return {
    id: payload.sub,
    login: payload.login,
    name: payload.name,
    role: payload.role,
    warehouseId: typeof payload.warehouseId === 'string' ? payload.warehouseId : null,
  };
}

async function startNats(): Promise<void> {
  try {
    nats = await connect({
      servers: config.NATS_URL,
      name: `cardops-notifications-${config.INSTANCE_ID}`,
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 1_000,
    });
    await redis.set('cardops:infra:nats', 'up');
    const subscription = nats.subscribe('cardops.events', { queue: 'notifications' });
    void (async () => {
      for await (const message of subscription) {
        try {
          const event = JSON.parse(new TextDecoder().decode(message.data)) as RealtimeEvent;
          await redis.publish('cardops.ws.events', JSON.stringify(event));
        } catch (error) {
          logger.warn({ err: error }, 'Invalid NATS event');
        }
      }
    })();
    void (async () => {
      for await (const status of nats!.status()) {
        if (status.type === 'disconnect' || status.type === 'error') {
          await redis.set('cardops:infra:nats', 'down');
        }
        if (status.type === 'reconnect') {
          await redis.set('cardops:infra:nats', 'up');
        }
      }
    })();
    logger.info({ nats: config.NATS_URL }, 'NATS consumer connected');
  } catch (error) {
    await redis.set('cardops:infra:nats', 'down');
    logger.error({ err: error }, 'NATS connection failed; retrying in background');
    setTimeout(() => void startNats(), 2_000);
  }
}

await redisSub.subscribe('cardops.ws.events', 'cardops.session.revoked');
redisSub.on('message', (channel, payload) => {
  if (channel === 'cardops.session.revoked') {
    hub.closeUser(payload);
    return;
  }
  try {
    hub.broadcast(JSON.parse(payload) as RealtimeEvent);
  } catch (error) {
    logger.warn({ err: error }, 'Invalid Redis realtime event');
  }
});

const app = new Hono();
const ws = createNodeWebSocket({ app });

app.get('/health', async (c) => {
  const redisOk = await redis
    .ping()
    .then(() => true)
    .catch(() => false);
  return c.json({
    data: {
      status: redisOk ? 'ok' : 'degraded',
      instance: config.INSTANCE_ID,
      connections: hub.size,
      nats: (await redis.get('cardops:infra:nats')) ?? 'unknown',
    },
  });
});

app.get('/ws', async (c, next) => {
  if (!originAllowed(c.req.header('origin'))) {
    return c.text('Forbidden origin', 403);
  }
  let principal: RealtimePrincipal;
  try {
    principal = await principalFromToken(tokenFromRequest(c.req.header('cookie')));
  } catch {
    return c.text('Unauthorized', 401);
  }

  return ws.upgradeWebSocket(() => ({
    onOpen(_event, socket) {
      hub.attach(socket, principal);
    },
    onClose(_event, socket) {
      hub.detach(socket);
    },
    onError(_event, socket) {
      hub.detach(socket);
    },
    onMessage(event, socket) {
      if (event.data === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', at: new Date().toISOString() }));
      }
    },
  }))(c, next);
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  logger.info({ port: info.port, instance: config.INSTANCE_ID }, 'Notifications service listening');
});
ws.injectWebSocket(server);

const heartbeat = setInterval(() => {
  hub.heartbeat();
  const now = Date.now();
  void redis
    .multi()
    .zadd('cardops:ws:instances', now, config.INSTANCE_ID)
    .zremrangebyscore('cardops:ws:instances', 0, now - 30_000)
    .expire('cardops:ws:instances', 60)
    .exec()
    .catch(() => undefined);
}, 10_000);
heartbeat.unref();

void redis
  .multi()
  .zadd('cardops:ws:instances', Date.now(), config.INSTANCE_ID)
  .hset('cardops:ws:clients', config.INSTANCE_ID, 0)
  .exec()
  .catch(() => undefined);

await startNats();

async function shutdown(signal: string): Promise<void> {
  if (stopped) return;
  stopped = true;
  logger.info({ signal }, 'Shutting down notifications');
  clearInterval(heartbeat);
  hub.closeAll();
  await redis
    .multi()
    .zrem('cardops:ws:instances', config.INSTANCE_ID)
    .hdel('cardops:ws:clients', config.INSTANCE_ID)
    .exec()
    .catch(() => undefined);
  await nats?.drain().catch(() => undefined);
  redisSub.disconnect();
  redis.disconnect();
  server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
