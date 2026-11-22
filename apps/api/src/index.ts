import { serve } from '@hono/node-server';
import { loadConfig } from './config/env';
import { createDatabase } from './db/client';
import { createLogger } from './lib/logger';
import { createRedis } from './lib/redis';
import { createApp } from './http/app';
import { RedisRateLimiter } from './modules/auth/rate-limiter';
import { SessionStore } from './modules/auth/session-store';
import { RedisOutboxSignal } from './realtime/outbox.signal';
import { DocumentsClient } from './modules/documents/documents.client';
import type { AppDeps } from './app.deps';

const config = loadConfig();
const logger = createLogger(config);
const database = createDatabase(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const sessions = new SessionStore(redis);

const deps: AppDeps = {
  config,
  db: database.db,
  logger,
  redis,
  sessions,
  outbox: new RedisOutboxSignal(redis),
  rateLimiter: new RedisRateLimiter(redis),
  documents: new DocumentsClient(config),
};

const app = createApp(deps);

const server = serve(
  {
    fetch: app.fetch,
    port: config.PORT,
    hostname: config.HOST,
  },
  (info) => {
    logger.info(
      { port: info.port, env: config.NODE_ENV },
      `CardOps core API listening on http://localhost:${info.port}`,
    );
  },
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down core API');
  server.close();
  redis.disconnect();
  await database.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  logger.error({ err: error }, 'Unhandled rejection');
});
