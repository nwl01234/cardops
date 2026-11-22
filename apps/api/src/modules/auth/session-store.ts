import type { RedisClient } from '../../lib/redis';

const sessionKey = (familyId: string) => `cardops:session:${familyId}`;
const userSessionsKey = (userId: string) => `cardops:user:sessions:${userId}`;
const userTombstoneKey = (userId: string) => `cardops:user:revoked:${userId}`;
const familyTombstoneKey = (familyId: string) => `cardops:family:revoked:${familyId}`;

/** Tombstones outlive a rotation/revocation race, then are garbage-collected. */
const TOMBSTONE_TTL_SECONDS = 300;

interface SessionValue {
  userId: string;
  createdAt: string;
}

export class SessionStore {
  constructor(private readonly redis: RedisClient) {}

  async create(
    familyId: string,
    userId: string,
    ttlSeconds: number,
    createdAt: Date = new Date(),
  ): Promise<void> {
    const value: SessionValue = { userId, createdAt: createdAt.toISOString() };
    await this.redis
      .multi()
      .set(sessionKey(familyId), JSON.stringify(value), 'EX', ttlSeconds)
      .sadd(userSessionsKey(userId), familyId)
      .exec();
  }

  async isActive(familyId: string): Promise<boolean> {
    const raw = await this.redis.get(sessionKey(familyId));
    if (!raw) return false;

    let value: SessionValue;
    try {
      value = JSON.parse(raw) as SessionValue;
    } catch {
      await this.redis.del(sessionKey(familyId));
      return false;
    }
    if (typeof value.userId !== 'string' || typeof value.createdAt !== 'string') {
      await this.redis.del(sessionKey(familyId));
      return false;
    }

    const [familyRevoked, userRevoked] = await Promise.all([
      this.redis.get(familyTombstoneKey(familyId)),
      this.redis.get(userTombstoneKey(value.userId)),
    ]);
    const created = Date.parse(value.createdAt);
    if (!Number.isFinite(created)) {
      await this.redis.del(sessionKey(familyId));
      return false;
    }
    const revoked =
      (familyRevoked !== null && Number(familyRevoked) >= created) ||
      (userRevoked !== null && Number(userRevoked) >= created);
    if (revoked) {
      await this.redis.del(sessionKey(familyId));
      return false;
    }
    return true;
  }

  async touch(familyId: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(sessionKey(familyId), ttlSeconds);
  }

  async revokeFamily(familyId: string, userId: string): Promise<void> {
    // The tombstone catches a refresh that commits after the key deletion but
    // was issued before the revocation.
    await this.redis
      .multi()
      .set(familyTombstoneKey(familyId), String(Date.now()), 'EX', TOMBSTONE_TTL_SECONDS)
      .del(sessionKey(familyId))
      .srem(userSessionsKey(userId), familyId)
      .publish('cardops.session.revoked', userId)
      .exec();
  }

  async revokeUser(userId: string): Promise<number> {
    // Set the tombstone before reading the Set: an in-flight refresh that adds
    // a family afterwards is still rejected by isActive().
    await this.redis.set(userTombstoneKey(userId), String(Date.now()), 'EX', TOMBSTONE_TTL_SECONDS);

    const families = await this.redis.smembers(userSessionsKey(userId));
    if (families.length === 0) {
      // Even without a Set entry (lost key / restart), connected sockets must
      // hear about the revocation and close.
      await this.redis.publish('cardops.session.revoked', userId);
      return 0;
    }
    await this.redis
      .multi()
      .del(...families.map(sessionKey))
      .del(userSessionsKey(userId))
      .publish('cardops.session.revoked', userId)
      .exec();
    return families.length;
  }
}
