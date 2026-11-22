import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) loadDotenv({ path: candidate, override: false, quiet: true });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8791),
  HOST: z.string().default('127.0.0.1'),
  JWT_SECRET: z.string().min(32),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  OCR_RATE_LIMIT: z.coerce.number().int().min(1).max(120).default(10),
  OCR_RATE_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  TESSDATA_PATH: z.string().default('.data/tessdata'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type ScanConfig = z.infer<typeof schema>;

export function loadConfig(): ScanConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid scan configuration: ${parsed.error.issues
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
