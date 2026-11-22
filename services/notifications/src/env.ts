import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) loadDotenv({ path: candidate, override: false, quiet: true });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8790),
  HOST: z.string().default('127.0.0.1'),
  JWT_SECRET: z.string().min(32),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  NATS_URL: z.string().default('nats://127.0.0.1:4222'),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  INSTANCE_ID: z.string().default(`notifications-${process.pid}`),
});

export type NotificationsConfig = z.infer<typeof schema>;

export function loadConfig(): NotificationsConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid notifications configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  if (
    parsed.data.NODE_ENV === 'production' &&
    (parsed.data.JWT_SECRET.startsWith('dev-only-') || parsed.data.JWT_SECRET.includes('change-me'))
  ) {
    throw new Error('Refusing production startup with the demo JWT_SECRET');
  }
  return parsed.data;
}
