import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  CirclePlus,
  FilterX,
  Search,
  SlidersHorizontal,
  WalletCards,
  X,
} from 'lucide-react';
import { CARD_STATUSES, can, type CardDto, type CardStatus } from '@cardops/shared';
import { api } from '@/api/client';
import { useAuth } from '@/auth/auth-provider';
import { Button, IconButton, buttonStyles } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/badge';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Input, Select } from '@/components/ui/field';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { CreateCardModal } from '@/components/cards/create-card-modal';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { formatRelative, pluralCards } from '@/lib/format';
import { STATUS_META } from '@/lib/labels';
import { qk } from '@/lib/query-client';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 20;

const statusOptions = [
  { value: 'all', label: 'Все' },
  ...CARD_STATUSES.map((status) => ({ value: status, label: STATUS_META[status].label })),
] as const;

type StatusFilter = (typeof statusOptions)[number]['value'];

function isStatus(value: string | null): value is CardStatus {
  return value !== null && (CARD_STATUSES as readonly string[]).includes(value);
}

function HolderCell({ card }: { card: CardDto }) {
  if (card.holder) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink">
        <span className="size-1.5 rounded-full bg-sky-500" />
        {card.holder.name}
      </span>
    );
  }
  if (card.owner) {
    return <span className="text-xs text-muted">владелец · {card.owner.name}</span>;
  }
  return <span className="text-xs text-muted/60">не закреплена</span>;
}

export function CardsPage() {
  useDocumentTitle('Карты');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const statusParam = searchParams.get('status');
  const status: StatusFilter = isStatus(statusParam) ? statusParam : 'all';
  const warehouseId = searchParams.get('warehouseId') ?? '';
  const mine = searchParams.get('mine') === 'true';
  const parsedPage = Number(searchParams.get('page') ?? 1);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const debouncedSearch = useDebouncedValue(search, 300);

  const canCreate = user ? can(user.role, 'card.create') : false;

  const warehousesQuery = useQuery({
    queryKey: qk.warehouses,
    queryFn: ({ signal }) => api.directory.warehouses(signal),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (current === debouncedSearch) return;
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) next.set('q', debouncedSearch);
    else next.delete('q');
    next.delete('page');
    setSearchParams(next, { replace: true });
    // searchParams intentionally read at the moment of the debounce tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/') return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const filters = useMemo(
    () => ({
      status: status === 'all' ? undefined : status,
      warehouseId: warehouseId || undefined,
      q: debouncedSearch || undefined,
      mine: mine || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [status, warehouseId, debouncedSearch, mine, page],
  );

  const cardsQuery = useQuery({
    queryKey: qk.cards(filters),
    queryFn: ({ signal }) => api.cards.list(filters, signal),
    refetchInterval: 60_000,
  });

  const totalPages = cardsQuery.data
    ? Math.max(1, Math.ceil(cardsQuery.data.total / PAGE_SIZE))
    : 1;

  useEffect(() => {
    if (!cardsQuery.data || page <= totalPages) return;
    const next = new URLSearchParams(searchParams);
    next.set('page', String(totalPages));
    setSearchParams(next, { replace: true });
    // Only react to a real out-of-range response; setSearchParams is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsQuery.data, page, totalPages]);

  const updateParams = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    setSearch('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  if (!user) return null;

  const data = cardsQuery.data;
  const hasFilters = status !== 'all' || Boolean(warehouseId) || Boolean(debouncedSearch) || mine;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Реестр"
        title="Карты"
        description="Единицы учёта с объектным доступом: менеджер видит только свои, склад — только свой склад."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)} icon={<CirclePlus className="size-4" />}>
              Создать карту
            </Button>
          ) : undefined
        }
      />

      <div className="panel p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <SegmentedControl<StatusFilter>
            label="Фильтр по статусу"
            value={status}
            onChange={(value) => updateParams({ status: value === 'all' ? null : value })}
            options={statusOptions}
            className="w-full xl:w-auto"
          />

          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по SKU или названию"
                className="pl-9 pr-9"
                aria-label="Поиск карт"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Очистить поиск"
                  className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted hover:text-ink"
                >
                  <X className="size-3.5" />
                </button>
              ) : (
                <span className="pointer-events-none absolute inset-y-0 right-3 hidden items-center text-[10px] text-muted/50 sm:flex">
                  /
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-52">
                <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                <Select
                  value={warehouseId}
                  onChange={(event) => updateParams({ warehouseId: event.target.value || null })}
                  aria-label="Фильтр по складу"
                  className="pl-9 text-xs"
                >
                  <option value="">Все склады</option>
                  {(warehousesQuery.data ?? []).map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.code}
                    </option>
                  ))}
                </Select>
              </div>

              {user.role === 'manager' ? (
                <button
                  type="button"
                  onClick={() => updateParams({ mine: mine ? null : 'true' })}
                  aria-pressed={mine}
                  className={cn(
                    'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors',
                    mine
                      ? 'border-brand-200 bg-brand-50 text-brand-800'
                      : 'border-line bg-white text-muted hover:text-ink',
                  )}
                >
                  Мои
                </button>
              ) : null}

              {hasFilters ? (
                <IconButton label="Сбросить фильтры" onClick={resetFilters}>
                  <FilterX className="size-4" />
                </IconButton>
              ) : null}
            </div>
          </div>
        </div>

        {hasFilters ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-[11px] text-muted">
            <span>Активные фильтры:</span>
            {status !== 'all' ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-800">
                {STATUS_META[status].label}
              </span>
            ) : null}
            {warehouseId ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-800">
                {warehousesQuery.data?.find((item) => item.id === warehouseId)?.code ?? 'склад'}
              </span>
            ) : null}
            {debouncedSearch ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-800">
                «{debouncedSearch}»
              </span>
            ) : null}
            {mine ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-800">
                только мои
              </span>
            ) : null}
            {data ? <span className="ml-auto">{pluralCards(data.total)}</span> : null}
          </div>
        ) : data ? (
          <div className="mt-2 text-right text-[11px] text-muted">{pluralCards(data.total)}</div>
        ) : null}
      </div>

      <Panel className="overflow-hidden">
        {cardsQuery.isLoading ? (
          <TableSkeleton />
        ) : cardsQuery.isError ? (
          <ErrorState
            message="Список карт не загрузился."
            onRetry={() => void cardsQuery.refetch()}
          />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={WalletCards}
            title={
              data && data.total > 0 && page > 1
                ? 'На этой странице нет карт'
                : hasFilters
                  ? 'Ничего не найдено'
                  : 'Карт пока нет'
            }
            description={
              data && data.total > 0 && page > 1
                ? `Всего карт: ${data.total}. Вернитесь на предыдущую страницу.`
                : hasFilters
                  ? 'Снимите часть фильтров или измените запрос.'
                  : 'Создайте первую карту — она появится на складе и в журнале.'
            }
            action={
              data && data.total > 0 && page > 1 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => updateParams({ page: String(Math.max(1, totalPages)) }, false)}
                >
                  На последнюю страницу
                </Button>
              ) : hasFilters ? (
                <Button variant="secondary" size="sm" onClick={resetFilters}>
                  Сбросить фильтры
                </Button>
              ) : canCreate ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  Создать карту
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-muted">
                    <th className="px-5 py-3 font-semibold">Карта</th>
                    <th className="px-4 py-3 font-semibold">Статус</th>
                    <th className="px-4 py-3 font-semibold">Склад</th>
                    <th className="px-4 py-3 font-semibold">Держатель / владелец</th>
                    <th className="px-4 py-3 font-semibold">Обновлено</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((card) => (
                    <tr key={card.id} className="group transition-colors hover:bg-brand-50/30">
                      <td className="px-5 py-3.5">
                        <Link to={`/cards/${card.id}`} className="block min-w-0">
                          <p className="truncate text-[13px] font-semibold text-ink group-hover:text-brand-800">
                            {card.title}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span className="font-mono text-[10px] text-muted">{card.sku}</span>
                            {card.maskedNumber ? (
                              <>
                                <span className="text-line">·</span>
                                <span className="font-mono text-[10px] text-muted/70">
                                  {card.maskedNumber}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={card.status} />
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-xs font-medium text-ink">{card.warehouse.name}</p>
                        <p className="text-[10px] text-muted">{card.warehouse.code}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <HolderCell card={card} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-xs text-muted">
                        {formatRelative(card.updatedAt)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link
                          to={`/cards/${card.id}`}
                          aria-label={`Открыть ${card.sku}`}
                          className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white hover:text-brand-800"
                        >
                          <ChevronRight className="size-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-line md:hidden">
              {data.items.map((card) => (
                <Link
                  key={card.id}
                  to={`/cards/${card.id}`}
                  className="block px-4 py-4 transition-colors active:bg-brand-50/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{card.title}</p>
                      <p className="mt-1 font-mono text-[10px] text-muted">{card.sku}</p>
                    </div>
                    <StatusBadge status={card.status} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted">
                    <span>{card.warehouse.name}</span>
                    <span>{formatRelative(card.updatedAt)}</span>
                  </div>
                  <div className="mt-1.5">
                    <HolderCell card={card} />
                  </div>
                </Link>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
              <p className="text-[11px] text-muted">
                Страница {page} из {totalPages}
                <span className="hidden sm:inline"> · по {PAGE_SIZE} на странице</span>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => updateParams({ page: String(page - 1) }, false)}
                  icon={<ArrowLeft className="size-3.5" />}
                >
                  Назад
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => updateParams({ page: String(page + 1) }, false)}
                >
                  Вперёд
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>

      <div className="flex items-center justify-between px-1 text-[10px] text-muted/70">
        <span>
          Показано {data?.items.length ?? 0} из {data?.total ?? 0}
        </span>
        {!canCreate ? (
          <span>Создание карт доступно администратору и складу</span>
        ) : (
          <Link to="/audit" className={buttonStyles('ghost', 'sm')}>
            Журнал действий
          </Link>
        )}
      </div>

      <CreateCardModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        user={user}
        warehouses={warehousesQuery.data ?? []}
        defaultWarehouseId={warehouseId || user.warehouseId || undefined}
      />
    </div>
  );
}
