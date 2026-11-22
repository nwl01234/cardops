import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  Building2,
  CalendarClock,
  ChevronRight,
  CreditCard,
  History,
  Lock,
  PackageCheck,
  RotateCcw,
  Send,
  ShieldCheck,
  UserRound,
  UserRoundCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TransitionAction, TransitionInput } from '@cardops/shared';
import { can } from '@cardops/shared';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-provider';
import { useToast } from '@/components/ui/toast';
import { buttonStyles } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { OperationTimeline } from '@/components/cards/operation-timeline';
import { TransitionDialog } from '@/components/cards/transition-dialog';
import { ForbiddenPage } from '@/pages/forbidden';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { newIdempotencyKey } from '@/lib/idempotency';
import { qk } from '@/lib/query-client';
import { ROLE_META, TRANSITION_META } from '@/lib/labels';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/hooks/use-document-title';

const actionIcons: Record<TransitionAction, LucideIcon> = {
  issue: Send,
  return: RotateCcw,
  restock: PackageCheck,
  write_off: Ban,
};

function DetailItem({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 grid size-7 place-items-center rounded-lg bg-black/[0.035] text-muted">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</p>
        <div className="mt-0.5 text-xs font-medium text-ink">{children}</div>
      </div>
    </div>
  );
}

function PersonValue({ user }: { user: { name: string; login: string } | null }) {
  if (!user) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={user.name} size="xs" />
      <span className="truncate">{user.name}</span>
      <span className="hidden text-[10px] text-muted sm:inline">@{user.login}</span>
    </span>
  );
}

export function CardDetailPage() {
  useDocumentTitle('Карточка');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<TransitionAction | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey('transition'));

  const detailQuery = useQuery({
    queryKey: qk.card(id ?? ''),
    queryFn: ({ signal }) => api.cards.get(id!, signal),
    enabled: Boolean(id),
    refetchInterval: 30_000,
  });

  const managersQuery = useQuery({
    queryKey: qk.users('manager'),
    queryFn: ({ signal }) => api.directory.users('manager', signal),
    enabled: Boolean(user && can(user.role, 'user.list')),
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (vars: { key: string; input: TransitionInput; action: TransitionAction }) =>
      api.cards.transition(id!, vars.input, vars.key),
    onSuccess: (result, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.card(id ?? '') });
      void queryClient.invalidateQueries({ queryKey: ['cards'] });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      setAction(null);

      if (result.meta.replayed) {
        toast({
          title: 'Повторный запрос — без дубля',
          description:
            'API вернул сохранённый ответ по Idempotency-Key. Новых записей в журнале нет.',
          tone: 'info',
        });
        return;
      }

      toast({
        title: TRANSITION_META[vars.action].label,
        description: `${result.data.sku} · операция записана в журнал`,
        duration: 8_000,
        action: {
          label: 'Повторить запрос',
          onClick: () => mutation.mutate(vars),
        },
      });

      // A manager who returns a card owned by another manager loses object
      // access immediately. Navigating away is clearer than a 403 refetch.
      if (
        vars.action === 'return' &&
        user?.role === 'manager' &&
        result.data.owner?.id !== user.id &&
        result.data.holder?.id !== user.id
      ) {
        navigate('/cards', { replace: true });
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: qk.card(id ?? '') });
      }
    },
  });

  const card = detailQuery.data;
  useDocumentTitle(card ? card.title : 'Карточка');

  if (!user) return null;
  if (detailQuery.isLoading) return <PageSkeleton />;
  if (detailQuery.isError) {
    if (detailQuery.error instanceof ApiError && detailQuery.error.status === 403) {
      return <ForbiddenPage />;
    }
    return (
      <div className="space-y-4">
        <Link
          to="/cards"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" /> К картам
        </Link>
        <ErrorState
          title="Карта недоступна"
          message={errorMessage(detailQuery.error, 'Карта не найдена или удалена.')}
          onRetry={() => void detailQuery.refetch()}
        />
      </div>
    );
  }
  if (!card) return null;

  const openAction = (next: TransitionAction) => {
    idempotencyKey.current = newIdempotencyKey(`transition-${next}`);
    mutation.reset();
    setAction(next);
  };

  const confirm = (input: TransitionInput) => {
    if (!card) return;
    mutation.mutate({
      key: idempotencyKey.current,
      input: { ...input, expectedVersion: card.version } as TransitionInput,
      action: input.action,
    });
  };

  return (
    <div className="space-y-5">
      <Link
        to="/cards"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Карты
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[11px] text-muted">
            <span className="font-mono font-semibold tracking-wide">{card.sku}</span>
            <CopyButton value={card.sku} label="Скопировать SKU" />
          </div>
          <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
            {card.title}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={card.status} />
            <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-semibold text-muted">
              v{card.version}
            </span>
            <span className="text-[11px] text-muted">
              обновлено {formatRelative(card.updatedAt)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <Link to={`/audit?cardId=${card.id}`} className={buttonStyles('secondary', 'md')}>
            <History className="size-4" />
            История в журнале
          </Link>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1.45fr_0.55fr]">
        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="Учётные данные"
              description="Чувствительные данные хранятся только в маскированном виде."
              action={<CreditCard className="size-4 text-muted" />}
            />
            <PanelBody className="space-y-5">
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-canvas/60 px-4 py-3.5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-brand-950 text-accent-400">
                    <CreditCard className="size-5" aria-hidden />
                  </span>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                      Номер карты
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-semibold tracking-wider text-ink">
                      {card.maskedNumber ?? 'не указан'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted sm:ml-auto">
                  <ShieldCheck className="size-3.5 text-brand-600" />
                  полный PAN не хранится
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <DetailItem icon={Building2} label="Склад">
                  <Link
                    to={`/cards?warehouseId=${card.warehouse.id}`}
                    className="hover:text-brand-800 hover:underline"
                  >
                    {card.warehouse.name}
                  </Link>
                  <span className="ml-1.5 font-mono text-[10px] text-muted">
                    {card.warehouse.code}
                  </span>
                </DetailItem>

                <DetailItem icon={UserRound} label="Владелец">
                  <PersonValue user={card.owner} />
                </DetailItem>

                <DetailItem icon={UserRoundCheck} label="Держатель">
                  <PersonValue user={card.holder} />
                </DetailItem>

                <DetailItem icon={CalendarClock} label="Выдана">
                  {card.issuedAt ? formatDateTime(card.issuedAt) : '—'}
                </DetailItem>

                <DetailItem icon={CalendarClock} label="Создана">
                  {formatDate(card.createdAt)}
                </DetailItem>

                <DetailItem icon={CalendarClock} label="Обновлена">
                  {formatDateTime(card.updatedAt)}
                </DetailItem>
              </div>

              {card.notes ? (
                <div className="border-t border-line pt-4">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                    Заметка
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink">{card.notes}</p>
                </div>
              ) : null}

              {card.writtenOffReason ? (
                <div className="rounded-xl border border-rose-100 bg-rose-50/70 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                    Причина списания
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-rose-900">
                    {card.writtenOffReason}
                  </p>
                </div>
              ) : null}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="История карты"
              description="Последние 12 операций · append-only"
              action={
                <Link
                  to={`/audit?cardId=${card.id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-900"
                >
                  Всё
                  <ChevronRight className="size-3.5" />
                </Link>
              }
            />
            <PanelBody>
              <OperationTimeline
                operations={card.operations}
                emptyText="Для этой карты ещё нет операций"
              />
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20">
          <Panel>
            <PanelHeader
              title="Действия"
              description="Список сформирован сервером для вашей роли."
            />
            <PanelBody className="space-y-2">
              {card.availableActions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-canvas/50 px-4 py-6 text-center">
                  <Lock className="mx-auto size-5 text-muted/60" />
                  <p className="mt-2 text-xs font-semibold text-ink">Действий нет</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    {user.role === 'manager'
                      ? 'Менеджер может вернуть только карту, выданную ему.'
                      : 'Для текущего статуса и вашей роли переходов нет.'}
                  </p>
                </div>
              ) : (
                card.availableActions.map((item) => {
                  const Icon = actionIcons[item];
                  const meta = TRANSITION_META[item];
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => openAction(item)}
                      className={cn(
                        'group flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                        item === 'issue' &&
                          'border-brand-200 bg-brand-50/70 hover:border-brand-300 hover:bg-brand-50',
                        item === 'write_off' &&
                          'border-rose-200 bg-rose-50/40 hover:border-rose-300 hover:bg-rose-50',
                        item !== 'issue' &&
                          item !== 'write_off' &&
                          'border-line bg-white hover:border-brand-200 hover:bg-brand-50/40',
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-8 shrink-0 place-items-center rounded-lg',
                          item === 'issue' && 'bg-brand-800 text-white',
                          item === 'write_off' && 'bg-rose-100 text-rose-700',
                          item !== 'issue' && item !== 'write_off' && 'bg-black/[0.04] text-muted',
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-ink">{meta.label}</span>
                        <span className="mt-0.5 block text-[10px] leading-snug text-muted">
                          {meta.description}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted/50 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  );
                })
              )}

              <div className="mt-3 space-y-2 rounded-xl bg-canvas/70 px-3.5 py-3 text-[10px] leading-relaxed text-muted">
                <p className="flex items-start gap-1.5">
                  <ShieldCheck className="mt-0.5 size-3 shrink-0 text-brand-600" />
                  Изменение статуса, запись в журнал и outbox-событие выполняются в одной
                  транзакции.
                </p>
                <p>
                  Повторная отправка с тем же Idempotency-Key вернёт сохранённый ответ и не
                  продублирует эффект.
                </p>
                <p>
                  Ваша роль:{' '}
                  <span className="font-semibold text-ink">{ROLE_META[user.role].label}</span>
                </p>
              </div>
            </PanelBody>
          </Panel>
        </div>
      </div>

      <TransitionDialog
        card={card}
        action={action}
        managers={managersQuery.data ?? []}
        pending={mutation.isPending}
        error={mutation.error}
        onClose={() => {
          setAction(null);
          mutation.reset();
        }}
        onConfirm={confirm}
      />
    </div>
  );
}
