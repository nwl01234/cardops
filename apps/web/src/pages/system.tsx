import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Database,
  GitBranch,
  Inbox,
  Radio,
  RefreshCw,
  ShieldCheck,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import type { OutboxEventDto } from '@cardops/shared';
import { api, ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { KpiCard } from '@/components/ui/kpi-card';
import { ErrorState } from '@/components/ui/error-state';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ForbiddenPage } from '@/pages/forbidden';
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format';
import { OPERATION_META } from '@/lib/labels';
import { qk } from '@/lib/query-client';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/hooks/use-document-title';

function outboxEventLabel(event: OutboxEventDto): string {
  return event.eventType in OPERATION_META
    ? OPERATION_META[event.eventType as keyof typeof OPERATION_META].short
    : event.eventType;
}

function OutboxStatus({ event }: { event: OutboxEventDto }) {
  if (event.processedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-800">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        processed
      </span>
    );
  }
  if (event.lastError) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-800">
        <span className="size-1.5 rounded-full bg-rose-500" />
        retry
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-900">
      <span className="size-1.5 rounded-full bg-amber-500" />
      pending
    </span>
  );
}

export function SystemPage() {
  useDocumentTitle('Система');
  const query = useQuery({
    queryKey: qk.system,
    queryFn: ({ signal }) => api.system.get(signal),
    refetchInterval: 5_000,
  });

  if (query.isLoading) return <PageSkeleton />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 403) return <ForbiddenPage />;
    return (
      <ErrorState message="Состояние системы недоступно." onRetry={() => void query.refetch()} />
    );
  }
  if (!query.data) return null;

  const data = query.data;
  const degraded = data.status === 'degraded';

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ops / admin"
        title="Состояние системы"
        description="Health, transactional outbox и realtime-подписчики. Экран доступен только роли admin."
        actions={
          <Button
            variant="secondary"
            onClick={() => void query.refetch()}
            loading={query.isFetching}
            icon={<RefreshCw className="size-4" />}
          >
            Обновить
          </Button>
        }
      />

      <div
        className={cn(
          'flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between',
          degraded ? 'border-amber-200 bg-amber-50/70' : 'border-brand-100 bg-brand-50/60',
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-2xl',
              degraded ? 'bg-amber-100 text-amber-800' : 'bg-brand-100 text-brand-800',
            )}
          >
            {degraded ? <TriangleAlert className="size-5" /> : <ShieldCheck className="size-5" />}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">
              {degraded ? 'Degraded: очередь требует внимания' : 'Все контуры работают'}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
              {degraded
                ? 'Есть неуспешные события или lag outbox больше 60 секунд.'
                : 'Бизнес-транзакции коммитятся, outbox разбирается, WebSocket-подписки активны.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Database className="size-3.5" />
            PostgreSQL · up
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Radio className="size-3.5" />
            {data.realtimeSubscribers} ws
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Timer className="size-3.5" />
            uptime {formatDuration(data.uptimeSeconds)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Activity className="size-3.5" />
            worker {data.worker.ageSeconds === null ? 'down' : `${data.worker.ageSeconds}s`}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <GitBranch className="size-3.5" />
            NATS {data.nats}
          </span>
          <span className="font-mono">v{data.version}</span>
        </div>
      </div>

      {data.alerts.length > 0 ? (
        <div className="space-y-2">
          {data.alerts.map((alert) => (
            <div
              key={alert.code}
              className={cn(
                'flex items-start gap-2 rounded-xl border px-4 py-2.5 text-xs',
                alert.severity === 'critical'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900',
              )}
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <strong className="font-mono text-[10px]">{alert.code}</strong> · {alert.message}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Outbox pending"
          value={data.outbox.pending}
          hint={
            data.outbox.oldestPendingAt
              ? `старейшее ${formatRelative(data.outbox.oldestPendingAt)}`
              : 'очередь пуста'
          }
          icon={Inbox}
          tone={data.outbox.pending > 0 ? 'amber' : 'emerald'}
        />
        <KpiCard
          label="Обработано за час"
          value={data.outbox.processedLastHour}
          hint="at-least-once delivery"
          icon={Activity}
          tone="brand"
        />
        <KpiCard
          label="Ошибки / retry"
          value={data.outbox.failed}
          hint="backoff до 60 секунд"
          icon={TriangleAlert}
          tone={data.outbox.failed > 0 ? 'rose' : 'emerald'}
        />
        <KpiCard
          label="Outbox lag"
          value={`${data.outbox.lagSeconds}s`}
          hint="от occurred_at до dispatch"
          icon={Timer}
          tone={data.outbox.lagSeconds > 60 ? 'amber' : 'sky'}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Последние события outbox"
            description="Событие пишется в одной транзакции с картой; dispatcher публикует его после commit."
            action={<GitBranch className="size-4 text-muted" />}
          />
          {data.recentOutbox.length === 0 ? (
            <p className="px-5 py-12 text-center text-xs text-muted">
              Событий пока нет. Создайте карту — транзакция добавит первую запись.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-[0.1em] text-muted">
                    <th className="px-5 py-2.5 font-semibold">ID</th>
                    <th className="px-3 py-2.5 font-semibold">Событие</th>
                    <th className="px-3 py-2.5 font-semibold">Статус</th>
                    <th className="px-3 py-2.5 font-semibold">Attempts</th>
                    <th className="px-5 py-2.5 font-semibold">Время</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.recentOutbox.map((event) => (
                    <tr key={event.id} className="text-[11px]">
                      <td className="px-5 py-3 font-mono text-muted">#{event.id}</td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-ink">{outboxEventLabel(event)}</p>
                        <p className="font-mono text-[9px] text-muted">{event.eventType}</p>
                      </td>
                      <td className="px-3 py-3">
                        <OutboxStatus event={event} />
                      </td>
                      <td className="px-3 py-3 tabular-nums text-muted">{event.attempts}</td>
                      <td className="px-5 py-3 text-muted">
                        <p>{formatRelative(event.occurredAt)}</p>
                        <p
                          className="text-[9px] text-muted/60"
                          title={formatDateTime(event.occurredAt)}
                        >
                          {formatDateTime(event.occurredAt)}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.recentOutbox.some((event) => event.lastError) ? (
            <div className="border-t border-line bg-rose-50/40 px-5 py-3">
              {data.recentOutbox
                .filter((event) => event.lastError)
                .slice(0, 2)
                .map((event) => (
                  <p key={event.id} className="font-mono text-[10px] text-rose-800">
                    #{event.id} · {event.lastError}
                  </p>
                ))}
            </div>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader
            title="Как устроен outbox"
            description="Минимум для demo, без Kafka ради галочки."
          />
          <PanelBody className="space-y-3">
            {[
              {
                title: '1 · Business transaction',
                text: 'status + audit + outbox_events коммитятся атомарно.',
              },
              {
                title: '2 · Dispatcher',
                text: 'SELECT … FOR UPDATE SKIP LOCKED, lease и backoff при ошибке.',
              },
              {
                title: '3 · NATS + Redis fanout',
                text: 'Worker публикует в NATS, notifications раздают событие через Redis Pub/Sub.',
              },
              {
                title: '4 · At-least-once',
                text: 'Клиент дедуплицирует по event id; dashboard делает refetch.',
              },
            ].map((step, index) => (
              <div key={step.title} className="flex gap-2.5">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[9px] font-bold text-brand-800">
                  {index + 1}
                </span>
                <div>
                  <p className="text-[11px] font-semibold text-ink">{step.title}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{step.text}</p>
                </div>
              </div>
            ))}
            <div className="rounded-xl bg-brand-950 px-3.5 py-3 text-[10px] leading-relaxed text-white/60">
              <p className="font-semibold text-accent-400">Production next</p>
              <p className="mt-1">
                Outbox publisher → NATS JetStream / Kafka, отдельный worker, DLQ и алерты по lag.
                Бизнес-код и контракт события не меняются.
              </p>
              <p className="mt-2 inline-flex items-center gap-1 text-white/40">
                <ArrowRight className="size-3" /> тот же transactional boundary
              </p>
            </div>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Distributed traces"
          description="Последние спаны из Redis: HTTP core, OCR и сервисные операции."
          action={<GitBranch className="size-4 text-muted" />}
        />
        {data.traces.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-muted">
            Спанов пока нет. Сделайте запрос или распознайте фото.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {data.traces.slice(0, 10).map((span, index) => (
              <div
                key={`${span.at}-${index}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[11px]"
              >
                <span className="rounded-full bg-brand-50 px-2 py-0.5 font-mono text-[9px] text-brand-800">
                  {span.service}
                </span>
                <span className="font-medium text-ink">{span.operation}</span>
                <span className="text-muted">{span.durationMs} ms</span>
                <span className="text-muted">status {span.status}</span>
                <span className="ml-auto font-mono text-[9px] text-muted/60">
                  {span.traceId?.slice(0, 8) ?? 'no-trace'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
