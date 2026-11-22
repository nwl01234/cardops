import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { Role, UserDto } from '@cardops/shared';
import type { AppConfig } from '../../config/env';
import { AppError } from '../../lib/errors';

const ISSUER = 'cardops';
const WEB_AUDIENCE = 'cardops-web';
const WS_AUDIENCE = 'cardops-ws';

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  login: string;
  sid: string;
  expiresAt: number;
}

function secretKey(config: AppConfig): Uint8Array {
  return new TextEncoder().encode(config.JWT_SECRET);
}

export async function signAccessToken(
  config: AppConfig,
  claims: { sub: string; role: Role; login: string; sid: string },
): Promise<string> {
  return new SignJWT({ role: claims.role, login: claims.login, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(WEB_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${config.JWT_TTL_MINUTES}m`)
    .sign(secretKey(config));
}

export interface RealtimeTicket {
  ticket: string;
  jti: string;
}

export async function signRealtimeTicket(
  config: AppConfig,
  user: UserDto,
  sid: string,
): Promise<RealtimeTicket> {
  const jti = randomUUID();
  const ticket = await new SignJWT({
    role: user.role,
    login: user.login,
    name: user.name,
    warehouseId: user.warehouseId,
    sid,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(WS_AUDIENCE)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(secretKey(config));
  return { ticket, jti };
}

async function verifyToken(
  config: AppConfig,
  token: string,
  audience: string,
): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, secretKey(config), {
      issuer: ISSUER,
      audience,
      algorithms: ['HS256'],
    });
    return payload;
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired access token');
  }
}

export async function readAccessToken(
  config: AppConfig,
  token: string,
): Promise<AccessTokenClaims> {
  const payload = await verifyToken(config, token, WEB_AUDIENCE);
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.login !== 'string' ||
    typeof payload.sid !== 'string'
  ) {
    throw new AppError('UNAUTHORIZED', 'Malformed access token');
  }
  if (typeof payload.exp !== 'number') {
    throw new AppError('UNAUTHORIZED', 'Access token has no expiry');
  }
  return {
    sub: payload.sub,
    login: payload.login,
    role: payload.role as Role,
    sid: payload.sid,
    expiresAt: payload.exp * 1000,
  };
}
