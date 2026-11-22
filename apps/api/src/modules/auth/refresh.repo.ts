import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { refreshTokens } from '../../db/schema';

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export async function insertRefreshToken(
  db: Database | Parameters<Parameters<Database['transaction']>[0]>[0],
  values: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
    createdAt?: Date;
  },
): Promise<string> {
  const rows = await db.insert(refreshTokens).values(values).returning({ id: refreshTokens.id });
  const row = rows[0];
  if (!row) throw new Error('Refresh token insert returned no row');
  return row.id;
}

export async function findRefreshToken(
  db: Database,
  tokenHash: string,
): Promise<RefreshTokenRecord | null> {
  const rows = await db
    .select({
      id: refreshTokens.id,
      userId: refreshTokens.userId,
      familyId: refreshTokens.familyId,
      tokenHash: refreshTokens.tokenHash,
      expiresAt: refreshTokens.expiresAt,
      revokedAt: refreshTokens.revokedAt,
    })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), gt(refreshTokens.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeRefreshToken(
  db: Database,
  id: string,
  replacedBy: string | null = null,
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedBy })
    .where(eq(refreshTokens.id, id));
}

export async function revokeFamily(db: Database, familyId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}
