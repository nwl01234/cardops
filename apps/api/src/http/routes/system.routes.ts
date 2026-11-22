import { Hono } from 'hono';
import type { SystemHealthDto } from '@cardops/shared';
import type { AppDeps } from '../../app.deps';
import type { AppEnv } from '../context';
import { requireCapability } from '../middleware/auth';
import { sendData } from '../respond';
import {
  getOutboxStats,
  recentOutboxEvents,
  replayDeadLetters,
} from '../../modules/outbox/outbox.repo';

interface TraceSpan {
  traceId: string | null;
  service: string;
  operation: string;
  durationMs: number;
  status: string;
  at: string;
}

export function systemRoutes(deps: AppDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/', requireCapability('system.read'), async (c) => {
    const [outbox, recent, workerHeartbeat, nats, clients, traces] = await Promise.all([
      getOutboxStats(deps.db),
      recentOutboxEvents(deps.db, 15),
      deps.redis.get('cardops:worker:heartbeat'),
      deps.redis.get('cardops:infra:nats'),
      deps.redis.hgetall('cardops:ws:clients'),
      deps.redis.lrange('cardops:traces', 0, 19),
    ]);

    const workerAgeSeconds = workerHeartbeat
      ? Math.floor((Date.now() - new Date(workerHeartbeat).getTime()) / 1000)
      : null;
    const realtimeSubscribers = Object.values(clients ?? {}).reduce(
      (sum, value) => sum + Number(value ?? 0),
      0,
    );

    const parsedTraces = traces
      .map((raw) => {
        try {
          return JSON.parse(raw) as TraceSpan;
        } catch {
          return null;
        }
      })
      .filter((span): span is TraceSpan => span !== null);

    const alerts: Array<{ code: string; severity: 'warning' | 'critical'; message: string }> = [];
    if (outbox.lagSeconds > 60) {
      alerts.push({
        code: 'OUTBOX_LAG',
        severity: 'critical',
        message: `Outbox lag ${outbox.lagSeconds}s`,
      });
    }
    if (outbox.failed > 0) {
      alerts.push({
        code: 'OUTBOX_FAILED',
        severity: 'warning',
        message: `${outbox.failed} outbox event(s) need retry`,
      });
    }
    if (outbox.deadLettered > 0) {
      alerts.push({
        code: 'OUTBOX_DLQ',
        severity: 'critical',
        message: `${outbox.deadLettered} event(s) in dead-letter queue`,
      });
    }
    if (workerAgeSeconds === null || workerAgeSeconds > 15) {
      alerts.push({
        code: 'WORKER_DOWN',
        severity: 'critical',
        message: 'Outbox worker heartbeat is stale',
      });
    }
    if (nats !== 'up') {
      alerts.push({
        code: 'NATS_DOWN',
        severity: 'critical',
        message: 'NATS connection is not confirmed',
      });
    }
    if (realtimeSubscribers === 0) {
      alerts.push({
        code: 'NO_REALTIME',
        severity: 'warning',
        message: 'No WebSocket clients connected',
      });
    }

    const health: SystemHealthDto & {
      worker: { heartbeat: string | null; ageSeconds: number | null };
      nats: string;
      alerts: typeof alerts;
      traces: TraceSpan[];
    } = {
      status: alerts.some((alert) => alert.severity === 'critical') ? 'degraded' : 'ok',
      database: 'up',
      outbox,
      recentOutbox: recent.map((row) => ({
        id: String(row.id),
        eventType: row.eventType,
        attempts: row.attempts,
        occurredAt: row.occurredAt.toISOString(),
        processedAt: row.processedAt?.toISOString() ?? null,
        deadLetteredAt: row.deadLetteredAt?.toISOString() ?? null,
        lastError: row.lastError,
      })),
      realtimeSubscribers,
      uptimeSeconds: Math.floor(process.uptime()),
      version: deps.config.APP_VERSION,
      worker: { heartbeat: workerHeartbeat, ageSeconds: workerAgeSeconds },
      nats: nats ?? 'unknown',
      alerts,
      traces: parsedTraces,
    };

    return sendData(c, health);
  });

  router.post('/outbox/replay', requireCapability('system.read'), async (c) => {
    const replayed = await replayDeadLetters(deps.db);
    return sendData(c, { replayed });
  });

  return router;
}
