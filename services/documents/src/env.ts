import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) loadDotenv({ path: candidate, override: false, quiet: true });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8792),
  HOST: z.string().default('127.0.0.1'),
  DOCUMENTS_INTERNAL_TOKEN: z.string().min(32),
  S3_ENDPOINT: z.string().default('127.0.0.1'),
  S3_PORT: z.coerce.number().int().default(9000),
  S3_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  S3_ACCESS_KEY: z.string().default('S3RVER'),
  S3_SECRET_KEY: z.string().default('S3RVER'),
  S3_BUCKET: z.string().default('cardops-documents'),
  PDF_FONT_PATH: z.string().default('assets/NotoSans-Regular.ttf'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type DocumentsConfig = z.infer<typeof schema>;

export function loadConfig(): DocumentsConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid documents configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  if (
    parsed.data.NODE_ENV === 'production' &&
    (parsed.data.DOCUMENTS_INTERNAL_TOKEN.startsWith('dev-only-') ||
      parsed.data.DOCUMENTS_INTERNAL_TOKEN.includes('change-me'))
  ) {
    throw new Error('Refusing production startup with the demo internal token');
  }
  return parsed.data;
}
