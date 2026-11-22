import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Ban,
  CirclePlus,
  History,
  PackageCheck,
  RotateCcw,
  ScrollText,
  Send,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { OPERATION_ACTIONS, type OperationAction, type OperationDto } from '@cardops/shared';
import { api } from '@/api/client';
import { useAuth } from '@/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/field';
import { Avatar } from '@/components/ui/avatar';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { TableSkeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatRelative, pluralRecords } from '@/lib/format';
import { AUDIT_ACTION_OPTIONS, OPERATION_META, ROLE_META, STATUS_META } from '@/lib/labels';
import { qk } from '@/lib/query-client';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/hooks/use-document-title';

const icons: Record<OperationAction, LucideIcon> = {
  'card.created': CirclePlus,
  'card.issued': Send,
  'card.returned': RotateCcw,
  'card.restocked': PackageCheck,
  'card.written_off': Ban,
};

const tones: Record<OperationAction, string> = {
  'card.created': 'bg-slate-100 text-slate-600',
  'card.issued': 'bg-sky-50 text-sky-700',
  'card.returned': 'bg-amber-50 text-amber-800',
  'card.restocked': 'bg-emerald-50 text-emerald-700',
  'card.written_off': 'bg-rose-50 text-rose-700',
};

function isOperationAction(value: string): value is OperationAction {
  return (OPERATION_ACTIONS as readonly string[]).includes(value);
}

function groupByDay(items: OperationDto[]): Array<{ label: string; items: OperationDto[] }> {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const groups = new Map<string, OperationDto[]>();
  for (const item of items) {
    const label = formatter.format(new Date(item.createdAt));
    const group = groups.get(label) ?? [];
    group.push(item);
    groups.set(label, group);
  }
  return [...groups.entries()].map(([label, groupItems]) => ({ label, items: groupItems }));
}

export function AuditPage() {
  useDocumentTitle('Журнал');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const actionParam = searchParams.get('action') ?? '';
  const action = isOperationAction(actionParam) ? actionParam : '';
  const cardId = searchParams.get('cardId') ?? '';

  const cardQuery = useQuery({
    queryKey: qk.card(cardId),
    queryFn: ({ signal }) => api.cards.get(cardId, signal),
    enabled: Boolean(cardId),
    retry: false,
  });

  const query = useInfiniteQuery({
    queryKey: qk.audit({ action, cardId }),
    queryFn: ({ pageParam, signal }) =>
      api.audit.list(
        {
          limit: 30,
          action: action || undefined,
          cardId: cardId || undefined,
          before: pageParam,
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 60_000,
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const all: OperationDto[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        all.push(item);
      }
    }
    return all;
  }, [query.data]);

  const groups = useMemo(() => groupByDay(items), [items]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  if (!user) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Аудит"
        title="Журнал действий"
        description="Append-only: UPDATE и DELETE на уровне PostgreSQL запрещены триггером. Запись создаётся в одной транзакции с изменением карты."
        actions={
          <Button
            variant="secondary"
            onClick={() => void query.refetch()}
            loading={query.isFetching && !query.isFetchingNextPage}
          >
            Обновить
          </Button>
        }
      />

      <div className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <ScrollText className="size-4 text-brand-700" />
          <span>Фильтры</span>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="w-full sm:w-52">
            <Select
              value={action}
              onChange={(event) => setParam('action', event.target.value || null)}
              aria-label="Фильтр по действию"
              className="text-xs"
            >
              {AUDIT_ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          {cardId ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-800">
              Карта: {cardQuery.data?.sku ?? cardId.slice(0, 8)}
              <button
                type="button"
                onClick={() => setParam('cardId', null)}
                aria-label="Убрать фильтр по карте"
                className="rounded-full p-0.5 hover:bg-brand-100"
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}

          <span className="ml-auto text-[11px] text-muted">{pluralRecords(items.length)}</span>
        </div>
      </div>

      <Panel className="overflow-hidden">
        {query.isLoading ? (
          <TableSkeleton />
        ) : query.isError ? (
          <ErrorState message="Журнал не загрузился." onRetry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={History}
            title="Журнал пуст"
            description={
              action || cardId
                ? 'По выбранным фильтрам операций нет.'
                : 'Создайте карту или выполните операцию — запись появится здесь.'
            }
            action={
              action || cardId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
                >
                  Сбросить фильтры
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div>
            {groups.map((group) => (
              <section key={group.label}>
                <div className="border-y border-line bg-canvas/70 px-4 py-2 sm:px-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                    {group.label}
                  </p>
                </div>
                <div className="divide-y divide-line">
                  {group.items.map((operation) => {
                    const Icon = icons[operation.action];
                    const meta = OPERATION_META[operation.action];
                    const reason =
                      typeof operation.details?.reason === 'string'
                        ? operation.details.reason
                        : null;

                    return (
                      <article
                        key={operation.id}
                        className="flex gap-3 px-4 py-4 transition-colors hover:bg-black/[0.012] sm:px-5"
                      >
                        <span
                          className={cn(
                            'mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl',
                            tones[operation.action],
                          )}
                        >
                          <Icon className="size-4" aria-hidden />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-xs font-semibold text-ink">{meta.label}</p>
                            {operation.card ? (
                              <Link
                                to={`/cards/${operation.card.id}`}
                                className="font-mono text-[11px] font-semibold text-brand-700 hover:underline"
                              >
                                {operation.card.sku}
                              </Link>
                            ) : null}
                            {operation.toStatus ? (
                              <StatusBadge status={operation.toStatus} />
                            ) : null}
                            {operation.fromStatus && operation.toStatus ? (
                              <span className="text-[10px] text-muted">
                                {STATUS_META[operation.fromStatus].label} →{' '}
                                {STATUS_META[operation.toStatus].label}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                            <span className="inline-flex items-center gap-1.5">
                              <Avatar name={operation.actor?.name ?? 'Система'} size="xs" />
                              <span className="font-medium text-ink/80">
                                {operation.actor?.name ?? 'Система'}
                              </span>
                            </span>
                            {operation.actor ? (
                              <span className="font-mono text-[10px] text-muted/70">
                                @{operation.actor.login}
                              </span>
                            ) : null}
                            <span className="text-line">·</span>
                            <span title={formatDateTime(operation.createdAt)}>
                              {formatRelative(operation.createdAt)}
                            </span>
                            {operation.card ? (
                              <>
                                <span className="text-line">·</span>
                                <Link
                                  to={`/cards/${operation.card.id}`}
                                  className="truncate text-muted hover:text-brand-700"
                                >
                                  {operation.card.title}
                                </Link>
                              </>
                            ) : null}
                          </div>

                          {reason ? (
                            <p className="mt-2 rounded-lg bg-rose-50/70 px-2.5 py-1.5 text-[11px] text-rose-800">
                              Причина: {reason}
                            </p>
                          ) : null}
                        </div>

                        <span className="hidden shrink-0 items-center self-center text-[10px] font-mono text-muted/50 sm:flex">
                          #{operation.id}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void query.fetchNextPage()}
            loading={query.isFetchingNextPage}
          >
            Загрузить ещё
            <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : items.length > 0 ? (
        <p className="text-center text-[11px] text-muted">Конец журнала</p>
      ) : null}

      <p className="px-1 text-[10px] leading-relaxed text-muted/70">
        {ROLE_META[user.role].label}: записи ограничены объектным доступом, поэтому чужие карты не
        появляются в журнале. Пагинация — cursor по монотонному id, без offset-дрейфа.
      </p>
    </div>
  );
}
