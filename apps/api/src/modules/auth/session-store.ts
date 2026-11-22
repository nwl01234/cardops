import type { RedisClient } from '../../lib/redis';

const sessionKey = (familyId: string) => `cardops:session:${familyId}`;
const userSessionsKey = (userId: string) => `cardops:user:sessions:${userId}`;

export class SessionStore {
  constructor(private readonly redis: RedisClient) {}

  async create(familyId: string, userId: string, ttlSeconds: number): Promise<void> {
    await this.redis
      .multi()
      .set(sessionKey(familyId), userId, 'EX', ttlSeconds)
      .sadd(userSessionsKey(userId), familyId)
      .exec();
  }

  async isActive(familyId: string): Promise<boolean> {
    return (await this.redis.exists(sessionKey(familyId))) === 1;
  }

  async touch(familyId: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(sessionKey(familyId), ttlSeconds);
  }

  async revokeFamily(familyId: string, userId: string): Promise<void> {
    await this.redis
      .multi()
      .del(sessionKey(familyId))
      .srem(userSessionsKey(userId), familyId)
      .publish('cardops.session.revoked', userId)
      .exec();
  }

  async revokeUser(userId: string): Promise<number> {
    const families = await this.redis.smembers(userSessionsKey(userId));
    if (families.length === 0) return 0;
    await this.redis
      .multi()
      .del(...families.map(sessionKey))
      .del(userSessionsKey(userId))
      .publish('cardops.session.revoked', userId)
      .exec();
    return families.length;
  }
}
