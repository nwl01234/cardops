import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { LoginInput, UserDto } from '@cardops/shared';
import type { AppConfig } from '../../config/env';
import type { Database } from '../../db/client';
import { refreshTokens } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { sha256 } from '../../lib/hash';
import { burnPasswordCheck, verifyPassword } from '../../lib/password';
import { findUserById, findUserByLogin, toUserDto } from '../users/users.repo';
import type { SessionStore } from './session-store';
import { signAccessToken } from './token';
import { findRefreshToken, insertRefreshToken, revokeFamily } from './refresh.repo';

export interface LoginMeta {
  ip: string;
  userAgent: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshExpiresAt: Date;
  user: UserDto;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly sessions: SessionStore,
  ) {}

  async login(input: LoginInput, meta: LoginMeta): Promise<AuthTokens> {
    const login = input.login.toLowerCase();
    const user = await findUserByLogin(this.db, login);

    if (!user || !user.isActive) {
      await burnPasswordCheck(input.password);
      throw new AppError('INVALID_CREDENTIALS', 'Invalid login or password');
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) throw new AppError('INVALID_CREDENTIALS', 'Invalid login or password');

    return this.issueSession(user.id, meta);
  }

  async refresh(rawToken: string | undefined, meta: LoginMeta): Promise<AuthTokens> {
    if (!rawToken) throw new AppError('UNAUTHORIZED', 'Refresh token is missing');
    const tokenHash = sha256(rawToken);
    const existing = await findRefreshToken(this.db, tokenHash);

    if (!existing) throw new AppError('UNAUTHORIZED', 'Refresh token is invalid');
    if (existing.revokedAt) {
      // Reuse of a rotated token means the family may be compromised.
      await revokeFamily(this.db, existing.familyId);
      await this.sessions.revokeFamily(existing.familyId, existing.userId);
      throw new AppError('UNAUTHORIZED', 'Refresh token reuse detected');
    }

    const user = await findUserById(this.db, existing.userId);
    if (!user || !user.isActive) {
      await this.sessions.revokeFamily(existing.familyId, existing.userId);
      throw new AppError('UNAUTHORIZED', 'Session is no longer valid');
    }

    const nextRaw = randomBytes(48).toString('base64url');
    const nextHash = sha256(nextRaw);

    await this.db.transaction(async (tx) => {
      const claimed = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, existing.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });

      if (claimed.length === 0) {
        throw new AppError('UNAUTHORIZED', 'Refresh token was already used');
      }

      const nextId = await insertRefreshToken(tx, {
        userId: user.id,
        familyId: existing.familyId,
        tokenHash: nextHash,
        expiresAt: this.refreshExpiry(),
        userAgent: meta.userAgent,
        ip: meta.ip,
      });
      await tx
        .update(refreshTokens)
        .set({ replacedBy: nextId })
        .where(eq(refreshTokens.id, existing.id));

      return nextId;
    });

    await this.sessions.create(existing.familyId, user.id, this.refreshTtlSeconds());
    const accessToken = await signAccessToken(this.config, {
      sub: user.id,
      role: user.role,
      login: user.login,
      sid: existing.familyId,
    });

    return {
      accessToken,
      refreshToken: nextRaw,
      expiresInSeconds: this.config.JWT_TTL_MINUTES * 60,
      refreshExpiresAt: this.refreshExpiry(),
      user: toUserDto(user),
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const existing = await findRefreshToken(this.db, sha256(rawToken));
    if (!existing) return;
    await revokeFamily(this.db, existing.familyId);
    await this.sessions.revokeFamily(existing.familyId, existing.userId);
  }

  async revokeUserSessions(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, userId));
    await this.sessions.revokeUser(userId);
  }

  private async issueSession(userId: string, meta: LoginMeta): Promise<AuthTokens> {
    const user = await findUserById(this.db, userId);
    if (!user) throw new AppError('UNAUTHORIZED', 'User not found');

    const familyId = randomUUID();
    const rawToken = randomBytes(48).toString('base64url');
    const expiresAt = this.refreshExpiry();

    await insertRefreshToken(this.db, {
      userId: user.id,
      familyId,
      tokenHash: sha256(rawToken),
      expiresAt,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    await this.sessions.create(familyId, user.id, this.refreshTtlSeconds());

    const accessToken = await signAccessToken(this.config, {
      sub: user.id,
      role: user.role,
      login: user.login,
      sid: familyId,
    });

    return {
      accessToken,
      refreshToken: rawToken,
      expiresInSeconds: this.config.JWT_TTL_MINUTES * 60,
      refreshExpiresAt: expiresAt,
      user: toUserDto(user),
    };
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.refreshTtlSeconds() * 1000);
  }

  private refreshTtlSeconds(): number {
    return this.config.REFRESH_TTL_DAYS * 24 * 60 * 60;
  }
}
