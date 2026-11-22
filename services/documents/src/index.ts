import { timingSafeEqual } from 'node:crypto';
import { serve } from '@hono/node-server';
import { bodyLimit } from 'hono/body-limit';
import { Hono } from 'hono';
import pino from 'pino';
import { loadConfig } from './env';
import { actCardSchema, renderActPdf } from './pdf';
import { DocumentStorage } from './storage';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, base: { service: 'documents' } });
const storage = new DocumentStorage(config);

function internalAuthorized(header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(config.DOCUMENTS_INTERNAL_TOKEN);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const app = new Hono();

app.get('/health', async (c) => {
  const storageOk = await storage.healthy();
  return c.json({
    data: { status: storageOk ? 'ok' : 'degraded', storage: storageOk },
  });
});

app.post(
  '/documents/act',
  bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ error: { code: 'VALIDATION_ERROR', message: 'Body too large' } }, 413),
  }),
  async (c) => {
    if (!internalAuthorized(c.req.header('x-internal-token'))) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Internal token required' } }, 401);
    }

    const body = (await c.req.json().catch(() => null)) as { card?: unknown } | null;
    const parsed = actCardSchema.safeParse(body?.card);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues.map((issue) => issue.message).join('; '),
          },
        },
        400,
      );
    }

    const card = parsed.data;
    try {
      const pdf = await renderActPdf(card, config);
      await storage.put(`acts/${card.id}/v${card.version}.pdf`, pdf);
      const filename = `cardops-${card.sku.replace(/[^A-Za-z0-9-]/g, '') || 'act'}.pdf`;
      return new Response(Buffer.from(pdf), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'private, no-store',
        },
      });
    } catch (error) {
      logger.error({ err: error, cardId: card.id }, 'Failed to render/store act');
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Document generation failed' } },
        500,
      );
    }
  },
);

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  logger.info(
    { port: info.port, bucket: config.S3_BUCKET, endpoint: config.S3_ENDPOINT },
    'Documents service listening',
  );
});

async function shutdown(): Promise<void> {
  logger.info('Shutting down documents');
  server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
