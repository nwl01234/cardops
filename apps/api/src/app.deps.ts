import type { AppConfig } from './config/env';
import type { Database } from './db/client';
import type { AppLogger } from './lib/logger';
import type { RedisClient } from './lib/redis';
import type { OutboxSignal } from './realtime/outbox.signal';
import type { RedisRateLimiter } from './modules/auth/rate-limiter';
import type { SessionStore } from './modules/auth/session-store';
import type { DocumentsClient } from './modules/documents/documents.client';

export interface AppDeps {
  config: AppConfig;
  db: Database;
  logger: AppLogger;
  redis: RedisClient;
  sessions: SessionStore;
  outbox: OutboxSignal;
  rateLimiter: RedisRateLimiter;
  documents: DocumentsClient;
}
