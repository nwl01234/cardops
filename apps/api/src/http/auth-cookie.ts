import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import type { AppConfig } from '../config/env';
import type { AppContext } from './context';

export const SESSION_COOKIE = 'cardops_session';
export const REFRESH_COOKIE = 'cardops_refresh';
export const WS_TICKET_COOKIE = 'cardops_ws_ticket';

function baseCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.COOKIE_SECURE,
    path: '/',
  };
}

export function setAuthCookies(
  c: AppContext,
  config: AppConfig,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  setCookie(c, SESSION_COOKIE, tokens.accessToken, {
    ...baseCookieOptions(config),
    maxAge: config.JWT_TTL_MINUTES * 60,
  });
  setCookie(c, REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookieOptions(config),
    path: '/api/auth',
    expires: tokens.refreshExpiresAt,
  });
}

export function setWsTicketCookie(c: AppContext, config: AppConfig, ticket: string): void {
  setCookie(c, WS_TICKET_COOKIE, ticket, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.COOKIE_SECURE,
    path: '/ws',
    maxAge: 120,
  });
}

export function clearAuthCookies(c: AppContext, config: AppConfig): void {
  deleteCookie(c, SESSION_COOKIE, {
    path: '/',
    secure: config.COOKIE_SECURE,
  });
  deleteCookie(c, REFRESH_COOKIE, {
    path: '/api/auth',
    secure: config.COOKIE_SECURE,
  });
}

export function readSessionCookie(c: AppContext): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function readRefreshCookie(c: AppContext): string | undefined {
  return getCookie(c, REFRESH_COOKIE);
}
