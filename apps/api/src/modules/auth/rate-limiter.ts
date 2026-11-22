import type { RedisClient } from '../../lib/redis';

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

/**
 * Redis-backed sliding/fixed window. INCR + PEXPIRE are executed atomically in
 * Lua, so multiple API replicas share the same limit.
 */
export class RedisRateLimiter {
  constructor(private readonly redis: RedisClient) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const script = `
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
      local ttl = redis.call('PTTL', KEYS[1])
      return {count, ttl}
    `;

    const result = (await this.redis.eval(script, 1, `cardops:rate:${key}`, windowMs)) as [
      number,
      number,
    ];
    const [count, ttl] = result;

    if (count > limit) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil(ttl / 1000)),
      };
    }
    return { allowed: true, retryAfter: 0 };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`cardops:rate:${key}`);
  }
}
