import type { RedisClient } from '../lib/redis';

export interface OutboxSignal {
  wake(): void;
}

export class RedisOutboxSignal implements OutboxSignal {
  constructor(private readonly redis: RedisClient) {}

  wake(): void {
    void this.redis.publish('cardops.outbox.wake', String(Date.now())).catch(() => undefined);
  }
}
