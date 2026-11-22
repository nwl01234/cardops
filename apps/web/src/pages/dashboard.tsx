import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Ban,
  Building2,
  CirclePlus,
  History,
  PackageCheck,
  PackageOpen,
  RotateCcw,
  Send,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { OperationAction, UserDto } from '@cardops/shared';
import { can } from '@cardops/shared';
import { api } from '@/api/client';
import { useAuth } from '@/auth/auth-provider';
import { useRealtime } from '@/realtime/realtime-provider';
import { Button, buttonStyles } from '@/components/ui/button';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { CreateCardModal } from '@/components/cards/create-card-modal';
import { formatRelative, pluralWarehouses } from '@/lib/format';
import { OPERATION_META, ROLE_META } from '@/lib/labels';
import { qk } from '@/lib/query-client';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/hooks/use-document-title';

const operationIcons: Record<OperationAction, LucideIcon> = {
  'card.created': CirclePlus,
  'card.issued': Send,
  'card.returned': RotateCcw,
  'card.restocked': PackageCheck,
  'card.written_off': Ban,
};

const operationTones: Record<OperationAction, string> = {
  'card.created': 'bg-slate-100 text-slate-600',
  'card.issued': 'bg-sky-50 text-sky-700',
  'card.returned': 'bg-amber-50 text-amber-800',
  'card.restocked': 'bg-emerald-50 text-emerald-700',
  'card.written_off': 'bg-rose-50 text-rose-700',
};

function accessText(user: UserDto): string[] {
  if (user.role === 'admin') {
    return ['Все склады и карты', 'Выдача, возврат, списание', 'Системные события'];
  }
  if (user.role === 'warehouse') {
    return [
      `Только склад ${user.warehouseName ?? '—'}`,
      'Создание и операции в своём складе',
      'Без доступа к чужим складам',
    ];
  }
  return [
    'Карты, где вы владелец или держатель',
    'Возврат закреплённых карт',
    'Без создания и списания',
  ];
}

export function DashboardPage() {
  useDocumentTitle('Обзор');
  const { user } = useAuth();
  const { status } = useRealtime();
  const [createOpen, setCreateOpen] = useState(false);

  const dashboardQuery = useQuery({
    queryKey: qk.dashboard,
    queryFn: ({ signal }) => api.dashboard.get(signal),
    refetchInterval: 60_000,
  });

  const canCreate = user ? can(user.role, 'card.create') : false;
  const warehousesQuery = useQuery({
    queryKey: qk.warehouses,
    queryFn: ({ signal }) => api.directory.warehouses(signal),
    enabled: canCreate,
    staleTime: 5 * 60_000,
  });

  if (!user) return null;
  if (dashboardQuery.isLoading) return <PageSkeleton />;
  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <ErrorState
        message="Дашборд не загрузился. Проверьте API и повторите."
        onRetry={() => void dashboardQuery.refetch()}
      />
    );
  }

  const data = dashboardQuery.data;
  const total = Math.max(1, data.stats.total);
  const completed = data.stats.inStock + data.stats.issued + data.stats.returned;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Оперативный контур"
        title="Обзор"
        description="Склад, выдачи и журнал в одном срезе. Данные обновляются по WebSocket после commit."
        actions={
          <>
            <Link to="/audit" className={buttonStyles('secondary', 'md')}>
              <History className="size-4" />
              Журнал
            </Link>
            {canCreate ? (
              <Button onClick={() => setCreateOpen(true)} icon={<CirclePlus className="size-4" />}>
                Создать карту
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1">
          <ShieldCheck className="size-3.5 text-brand-600" />
          {ROLE_META[user.role].label}
        </span>
        <span className="text-muted/50">·</span>
        <span>{accessText(user)[0]}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-800">
          <span
            className={cn(
              'size-1.5 rounded-full',
              status === 'open' && 'live-dot bg-emerald-500',
              status === 'connecting' && 'bg-amber-500',
              status === 'closed' && 'bg-slate-400',
            )}
          />
          {status === 'open'
            ? 'realtime включён'
            : status === 'connecting'
              ? 'realtime подключается'
              : 'realtime недоступен'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <KpiCard
          label="Всего карт"
          value={data.stats.total}
          hint={
            user.role === 'manager'
              ? `${data.stats.mine} закреплено за вами`
              : `в контуре ${pluralWarehouses(data.warehouses.length)}`
          }
          icon={WalletCards}
          tone="brand"
          progress={100}
        />
        <KpiCard
          label="На складе"
          value={data.stats.inStock}
          hint="доступно к выдаче"
          icon={PackageOpen}
          tone="emerald"
          progress={(data.stats.inStock / total) * 100}
        />
        <KpiCard
          label="Выдано"
          value={data.stats.issued}
          hint="у менеджеров"
          icon={Send}
          tone="sky"
          progress={(data.stats.issued / total) * 100}
        />
        <KpiCard
          label="Возвращено"
          value={data.stats.returned}
          hint="ожидает приёмки"
          icon={RotateCcw}
          tone="amber"
          progress={(data.stats.returned / total) * 100}
        />
        <KpiCard
          label="Списано"
          value={data.stats.writtenOff}
          hint={`${Math.round((data.stats.writtenOff / total) * 100)}% контура`}
          icon={Ban}
          tone="rose"
          progress={(data.stats.writtenOff / total) * 100}
          className="[grid-column:span_2/span_2] xl:[grid-column:auto]"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Последние операции"
            description="Append-only журнал; каждая строка создана в одной транзакции с изменением карты."
            action={
              <Link
                to="/audit"
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-900"
              >
                Весь журнал
                <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {data.recentOperations.length === 0 ? (
            <EmptyState
              icon={History}
              title="Пока нет операций"
              description="Создайте первую карту — событие появится здесь и обновит дашборд."
            />
          ) : (
            <div className="divide-y divide-line">
              {data.recentOperations.map((operation) => {
                const Icon = operationIcons[operation.action];
                const meta = OPERATION_META[operation.action];
                return (
                  <div
                    key={operation.id}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.015] sm:px-5"
                  >
                    <span
                      className={cn(
                        'grid size-9 shrink-0 place-items-center rounded-xl',
                        operationTones[operation.action],
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <p className="text-xs font-semibold text-ink">
                          {operation.actor?.name ?? 'Система'}
                        </p>
                        <span className="text-[11px] text-muted">{meta.label.toLowerCase()}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        {operation.card ? (
                          <Link
                            to={`/cards/${operation.card.id}`}
                            className="font-mono font-medium text-brand-700 hover:underline"
                          >
                            {operation.card.sku}
                          </Link>
                        ) : null}
                        <span className="text-line">·</span>
                        <span>{formatRelative(operation.createdAt)}</span>
                      </div>
                    </div>
                    {operation.toStatus ? (
                      <StatusBadge status={operation.toStatus} className="hidden sm:inline-flex" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="Склады"
              description="Срез доступных вам карт по статусам."
              action={<Building2 className="size-4 text-muted" />}
            />
            <div className="divide-y divide-line">
              {data.warehouses.map((entry) => {
                const count = entry.inStock + entry.issued + entry.returned + entry.writtenOff;
                return (
                  <div key={entry.warehouse.id} className="px-4 py-3.5 sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to={`/cards?warehouseId=${entry.warehouse.id}`}
                          className="block truncate text-xs font-semibold text-ink hover:text-brand-800"
                        >
                          {entry.warehouse.name}
                        </Link>
                        <p className="mt-0.5 text-[10px] text-muted">
                          {entry.warehouse.code} · {entry.warehouse.city}
                        </p>
                      </div>
                      <span className="text-xs font-semibold tabular-nums text-ink">{count}</span>
                    </div>

                    <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-black/[0.05]">
                      {count > 0 ? (
                        <>
                          <span
                            className="bg-emerald-500"
                            style={{ width: `${(entry.inStock / Math.max(1, count)) * 100}%` }}
                          />
                          <span
                            className="bg-sky-500"
                            style={{ width: `${(entry.issued / Math.max(1, count)) * 100}%` }}
                          />
                          <span
                            className="bg-amber-500"
                            style={{ width: `${(entry.returned / Math.max(1, count)) * 100}%` }}
                          />
                          <span
                            className="bg-rose-400"
                            style={{ width: `${(entry.writtenOff / Math.max(1, count)) * 100}%` }}
                          />
                        </>
                      ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
                      <span>склад {entry.inStock}</span>
                      <span>выдано {entry.issued}</span>
                      <span>возврат {entry.returned}</span>
                      <span>списано {entry.writtenOff}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-line px-4 py-2.5 text-[10px] text-muted sm:px-5">
              {completed} из {data.stats.total} карт находятся в активном обороте
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Ваш контур доступа"
              description="Права проверяются на API для каждого объекта."
              action={<ShieldCheck className="size-4 text-brand-600" />}
            />
            <PanelBody className="space-y-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={user.name} role={user.role} size="sm" />
                <div>
                  <p className="text-xs font-semibold text-ink">{user.name}</p>
                  <p className="text-[10px] text-muted">{ROLE_META[user.role].label}</p>
                </div>
              </div>
              <ul className="space-y-1.5">
                {accessText(user).map((line) => (
                  <li key={line} className="flex items-start gap-2 text-[11px] text-muted">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-400" />
                    {line}
                  </li>
                ))}
              </ul>
              <div className="rounded-xl bg-brand-50/70 px-3 py-2 text-[10px] leading-relaxed text-brand-900">
                Скрытая кнопка — только UX. Попытка обойти интерфейс вернёт 403 от API.
              </div>
            </PanelBody>
          </Panel>
        </div>
      </div>

      <CreateCardModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        user={user}
        warehouses={warehousesQuery.data ?? []}
        defaultWarehouseId={user.warehouseId ?? undefined}
      />
    </div>
  );
}
