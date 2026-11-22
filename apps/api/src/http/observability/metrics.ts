import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { Context } from 'hono';
import type { AppDeps } from '../../app.deps';
import type { AppEnv } from '../context';
import { getOutboxStats } from '../../modules/outbox/outbox.repo';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'cardops_' });

const httpRequests = new Counter({
  name: 'cardops_http_requests_total',
  help: 'HTTP requests by method, route and status',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

const httpDuration = new Histogram({
  name: 'cardops_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const outboxPending = new Gauge({
  name: 'cardops_outbox_pending',
  help: 'Pending outbox events',
  registers: [registry],
});

const outboxDeadLettered = new Gauge({
  name: 'cardops_outbox_dead_lettered',
  help: 'Events in the dead-letter queue',
  registers: [registry],
});

const outboxLag = new Gauge({
  name: 'cardops_outbox_lag_seconds',
  help: 'Age of the oldest pending outbox event',
  registers: [registry],
});

const wsConnections = new Gauge({
  name: 'cardops_ws_connections',
  help: 'Connected WebSocket clients across notifications instances',
  registers: [registry],
});

const workerHeartbeatAge = new Gauge({
  name: 'cardops_worker_heartbeat_age_seconds',
  help: 'Age of the outbox worker heartbeat',
  registers: [registry],
});

const natsUp = new Gauge({
  name: 'cardops_nats_up',
  help: 'NATS reported up (1) or not (0)',
  registers: [registry],
});

export async function observeRequest(c: Context<AppEnv>, durationMs: number): Promise<void> {
  if (c.req.path === '/metrics') return;
  const route = c.req.routePath || c.req.path;
  const labels = {
    method: c.req.method,
    route,
    status: String(c.res.status),
  };
  httpRequests.inc(labels);
  httpDuration.observe(labels, durationMs / 1000);
}

export async function metricsResponse(deps: AppDeps, c: Context<AppEnv>) {
  try {
    const [outbox, clients, heartbeat, nats] = await Promise.all([
      getOutboxStats(deps.db),
      deps.redis.hgetall('cardops:ws:clients'),
      deps.redis.get('cardops:worker:heartbeat'),
      deps.redis.get('cardops:infra:nats'),
    ]);
    outboxPending.set(outbox.pending);
    outboxDeadLettered.set(outbox.deadLettered);
    outboxLag.set(outbox.lagSeconds);
    wsConnections.set(
      Object.values(clients ?? {}).reduce((sum, value) => sum + Number(value ?? 0), 0),
    );
    workerHeartbeatAge.set(
      heartbeat ? Math.max(0, (Date.now() - new Date(heartbeat).getTime()) / 1000) : -1,
    );
    natsUp.set(nats === 'up' ? 1 : 0);
  } catch {
    // Keep the endpoint scrapeable even while PostgreSQL/Redis recover.
  }

  c.header('content-type', registry.contentType);
  c.header('cache-control', 'no-store');
  return c.body(await registry.metrics());
}
