import { serve } from '@hono/node-server';
import { bodyLimit } from 'hono/body-limit';
import { Hono } from 'hono';
import { jwtVerify } from 'jose';
import Redis from 'ioredis';
import { loadConfig } from './env';
import { sniffImageType } from './image';
import { createLogger } from './logger';
import { disposeOcr, OcrBusyError, OcrTimeoutError, recognize } from './ocr';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });

interface AccessClaims {
  sub: string;
  sid: string;
}

async function authenticate(cookieHeader: string | undefined): Promise<AccessClaims | null> {
  const token = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('cardops_session='))
    ?.split('=')[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.JWT_SECRET), {
      issuer: 'cardops',
      audience: 'cardops-web',
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string') return null;
    if (typeof payload.sid !== 'string') return null;
    if (!(await redis.exists(`cardops:session:${payload.sid}`))) return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

const app = new Hono();

const ORIGINS = (() => {
  const allowed = new Set([config.WEB_ORIGIN]);
  try {
    const web = new URL(config.WEB_ORIGIN);
    if (web.hostname === 'localhost') {
      allowed.add(`${web.protocol}//127.0.0.1${web.port ? `:${web.port}` : ''}`);
    } else if (web.hostname === '127.0.0.1') {
      allowed.add(`${web.protocol}//localhost${web.port ? `:${web.port}` : ''}`);
    }
  } catch {
    // Already validated by the config schema.
  }
  return allowed;
})();

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return config.NODE_ENV !== 'production';
  return ORIGINS.has(origin);
}

const RATE_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

async function consumeOcrQuota(userId: string): Promise<boolean> {
  const count = (await redis.eval(
    RATE_SCRIPT,
    1,
    `cardops:rate:ocr:${userId}`,
    config.OCR_RATE_WINDOW_SECONDS * 1_000,
  )) as number;
  return count <= config.OCR_RATE_LIMIT;
}

app.get('/health', async (c) => {
  const redisOk = await redis
    .ping()
    .then(() => true)
    .catch(() => false);
  return c.json({ data: { status: redisOk ? 'ok' : 'degraded', redis: redisOk } });
});

app.post(
  '/ocr',
  bodyLimit({
    maxSize: 8 * 1024 * 1024,
    onError: (c) =>
      c.json({ error: { code: 'VALIDATION_ERROR', message: 'Image exceeds 8 MB' } }, 413),
  }),
  async (c) => {
    if (!originAllowed(c.req.header('origin'))) {
      return c.json({ error: { code: 'INVALID_ORIGIN', message: 'Origin is not allowed' } }, 403);
    }

    const claims = await authenticate(c.req.header('cookie'));
    if (!claims) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401);

    try {
      if (!(await consumeOcrQuota(claims.sub))) {
        c.header('Retry-After', String(config.OCR_RATE_WINDOW_SECONDS));
        return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many OCR requests' } }, 429);
      }
    } catch {
      return c.json(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'OCR quota is unavailable' } },
        503,
      );
    }

    const contentType = c.req.header('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'multipart/form-data with "image" is required',
          },
        },
        400,
      );
    }

    let body: Record<string, string | File>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid multipart body' } },
        400,
      );
    }

    const image = body.image;
    if (!(image instanceof File)) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Field "image" is required' } },
        400,
      );
    }
    if (image.size > 8 * 1024 * 1024) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Image exceeds 8 MB' } }, 413);
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const sniffed = sniffImageType(buffer);
    if (!sniffed) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'PNG, JPEG, BMP or TIFF expected' } },
        415,
      );
    }
    const declared = image.type.toLowerCase();
    if (declared && declared !== 'application/octet-stream' && declared !== sniffed) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'File content does not match its type' } },
        415,
      );
    }

    try {
      const result = await recognize(buffer, config, logger);
      await redis
        .multi()
        .lpush(
          'cardops:traces',
          JSON.stringify({
            traceId: c.req.header('x-trace-id') ?? null,
            service: 'scan',
            operation: 'ocr.recognize',
            durationMs: result.durationMs,
            status: result.code ? 'ok' : 'no-code',
            at: new Date().toISOString(),
          }),
        )
        .ltrim('cardops:traces', 0, 199)
        .exec()
        .catch(() => undefined);

      return c.json({
        data: {
          text: result.text.slice(0, 2_000),
          code: result.code,
          confidence: result.confidence,
          durationMs: result.durationMs,
        },
      });
    } catch (error) {
      if (error instanceof OcrBusyError) {
        c.header('Retry-After', '5');
        return c.json(
          { error: { code: 'OCR_BUSY', message: 'OCR queue is full; retry shortly' } },
          503,
        );
      }
      if (error instanceof OcrTimeoutError) {
        return c.json(
          { error: { code: 'OCR_TIMEOUT', message: 'OCR timed out; enter the code manually' } },
          504,
        );
      }
      logger.error({ err: error }, 'OCR failed');
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'OCR failed; enter the code manually' } },
        500,
      );
    }
  },
);

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  logger.info({ port: info.port, tessdata: config.TESSDATA_PATH }, 'OCR scan service listening');
});

async function shutdown(): Promise<void> {
  logger.info('Shutting down OCR');
  await disposeOcr().catch(() => undefined);
  redis.disconnect();
  server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
