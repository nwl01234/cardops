import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Works both from the workspace (`apps/api`) and from the repo root.
 * In Docker/compose env vars are provided by the runtime, no file needed.
 */
for (const candidate of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(import.meta.dirname, '../../../../.env'),
]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate, override: false, quiet: true });
  }
}

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.url({ protocol: /^postgres/ }),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(15),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  COOKIE_SECURE: booleanFromString.default(false),
  ALLOW_INSECURE_COOKIE: booleanFromString.default(false),
  TRUST_PROXY: booleanFromString.default(false),
  SEED_DEMO: booleanFromString.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(3).max(1_000).default(10),
  LOGIN_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
  APP_VERSION: z.string().default('0.1.0'),
});

export type AppConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isTest: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const isProduction = parsed.data.NODE_ENV === 'production';
  if (isProduction) {
    if (!parsed.data.COOKIE_SECURE && !parsed.data.ALLOW_INSECURE_COOKIE) {
      throw new Error(
        'Refusing production startup with an insecure session cookie. ' +
          'Set COOKIE_SECURE=true behind TLS, or ALLOW_INSECURE_COOKIE=true for a local HTTP demo.',
      );
    }
    if (
      parsed.data.JWT_SECRET.startsWith('dev-only-') ||
      parsed.data.JWT_SECRET.includes('change-me')
    ) {
      throw new Error(
        'Refusing production startup with the demo JWT_SECRET. Provide a unique secret (32+ chars).',
      );
    }
  }

  return {
    ...parsed.data,
    isProduction,
    isTest: parsed.data.NODE_ENV === 'test',
  };
}
