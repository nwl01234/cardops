import type { RedisClient } from '../../lib/redis';

const sessionKey = (familyId: string) => `cardops:session:${familyId}`;
const userSessionsKey = (userId: string) => `cardops:user:sessions:${userId}`;
const userTombstoneKey = (userId: string) => `cardops:user:revoked:${userId}`;
const familyTombstoneKey = (familyId: string) => `cardops:family:revoked:${familyId}`;

/** Tombstones outlive a rotation/revocation race, then are garbage-collected. */
const TOMBSTONE_TTL_SECONDS = 300;

/**
 * Session value is `userId|createdAtMs`. The check is one Lua round trip:
 * session exists, neither family nor user tombstone is newer than the session.
 * A tombstone that is newer means a refresh raced an admin revoke; the session
 * is deleted instead of resurrecting access.
 */
const IS_ACTIVE_SCRIPT = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return 0 end
  local sep = string.find(raw, '|', 1, true)
  if not sep then redis.call('DEL', KEYS[1]); return 0 end
  local userId = string.sub(raw, 1, sep - 1)
  local created = tonumber(string.sub(raw, sep + 1))
  if not userId or not created then redis.call('DEL', KEYS[1]); return 0 end
  local familyRevoked = redis.call('GET', KEYS[2])
  local userRevoked = redis.call('GET', KEYS[3] .. userId)
  if (familyRevoked and tonumber(familyRevoked) >= created) or
     (userRevoked and tonumber(userRevoked) >= created) then
    redis.call('DEL', KEYS[1])
    return 0
  end
  return 1
`;

export class SessionStore {
  constructor(private readonly redis: RedisClient) {}

  async create(
    familyId: string,
    userId: string,
    ttlSeconds: number,
    createdAt: Date = new Date(),
  ): Promise<void> {
    await this.redis
      .multi()
      .set(sessionKey(familyId), `${userId}|${createdAt.getTime()}`, 'EX', ttlSeconds)
      .sadd(userSessionsKey(userId), familyId)
      .exec();
  }

  async isActive(familyId: string): Promise<boolean> {
    const active = (await this.redis.eval(
      IS_ACTIVE_SCRIPT,
      3,
      sessionKey(familyId),
      familyTombstoneKey(familyId),
      'cardops:user:revoked:',
    )) as number;
    return active === 1;
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
