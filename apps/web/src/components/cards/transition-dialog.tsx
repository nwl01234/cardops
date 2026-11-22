import { useEffect, useState } from 'react';
import type { CardDetailDto, TransitionAction, TransitionInput, UserDto } from '@cardops/shared';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/badge';
import { TRANSITION_META } from '@/lib/labels';
import { errorMessage } from '@/lib/errors';

interface TransitionDialogProps {
  card: CardDetailDto;
  action: TransitionAction | null;
  managers: UserDto[];
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (input: TransitionInput) => void;
}

export function TransitionDialog({
  card,
  action,
  managers,
  pending,
  error,
  onClose,
  onConfirm,
}: TransitionDialogProps) {
  const [holderId, setHolderId] = useState('');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!action) return;
    setHolderId('');
    setReason('');
    setLocalError(null);
  }, [action]);

  if (!action) return null;

  const meta = TRANSITION_META[action];

  const submit = () => {
    setLocalError(null);
    if (action === 'issue') {
      if (!holderId) {
        setLocalError('Выберите менеджера-получателя.');
        return;
      }
      onConfirm({ action: 'issue', holderId });
      return;
    }
    if (action === 'write_off') {
      if (reason.trim().length < 3) {
        setLocalError('Укажите причину, минимум 3 символа.');
        return;
      }
      onConfirm({ action: 'write_off', reason: reason.trim() });
      return;
    }
    onConfirm({ action });
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!pending}
      title={meta.confirmTitle}
      description={meta.description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button
            variant={action === 'write_off' ? 'danger' : 'primary'}
            onClick={submit}
            loading={pending}
            data-autofocus
          >
            {meta.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas/60 px-3.5 py-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-ink">{card.title}</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted">{card.sku}</p>
          </div>
          <StatusBadge status={card.status} />
        </div>

        {action === 'issue' ? (
          <Field label="Кому выдать" htmlFor="issue-holder" hint="Только активные менеджеры">
            <Select
              id="issue-holder"
              value={holderId}
              onChange={(event) => setHolderId(event.target.value)}
              data-autofocus
            >
              <option value="">Выберите менеджера</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name} · {manager.login}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {action === 'write_off' ? (
          <>
            <div className="flex gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" />
              <p className="text-[11px] leading-relaxed text-rose-800">
                Списание необратимо. Причина и автор навсегда останутся в append-only журнале.
              </p>
            </div>
            <Field label="Причина списания" htmlFor="write-off-reason">
              <Textarea
                id="write-off-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Повреждена при транспортировке"
                data-autofocus
              />
            </Field>
          </>
        ) : null}

        {action === 'return' ? (
          <p className="rounded-xl bg-canvas px-3.5 py-3 text-[11px] leading-relaxed text-muted">
            Текущий держатель:{' '}
            <span className="font-semibold text-ink">{card.holder?.name ?? '—'}</span>. После
            возврата карта станет недоступна менеджеру для действий.
          </p>
        ) : null}

        {action === 'restock' ? (
          <p className="rounded-xl bg-canvas px-3.5 py-3 text-[11px] leading-relaxed text-muted">
            Карта вернётся в статус «На складе» и снова сможет быть выдана.
          </p>
        ) : null}

        {localError || error ? (
          <p
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
            role="alert"
          >
            {localError ?? errorMessage(error, 'Операция не выполнена')}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
