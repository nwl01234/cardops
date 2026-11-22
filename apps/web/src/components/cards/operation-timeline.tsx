import type { LucideIcon } from 'lucide-react';
import { Ban, CirclePlus, PackageCheck, RotateCcw, Send } from 'lucide-react';
import type { OperationAction, OperationDto } from '@cardops/shared';
import { formatDateTime } from '@/lib/format';
import { OPERATION_META, STATUS_META } from '@/lib/labels';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/ui/badge';

const icons: Record<OperationAction, LucideIcon> = {
  'card.created': CirclePlus,
  'card.issued': Send,
  'card.returned': RotateCcw,
  'card.restocked': PackageCheck,
  'card.written_off': Ban,
};

const tones: Record<OperationAction, string> = {
  'card.created': 'bg-slate-100 text-slate-600 ring-slate-200',
  'card.issued': 'bg-sky-50 text-sky-700 ring-sky-100',
  'card.returned': 'bg-amber-50 text-amber-800 ring-amber-100',
  'card.restocked': 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  'card.written_off': 'bg-rose-50 text-rose-700 ring-rose-100',
};

export function OperationTimeline({
  operations,
  emptyText = 'Операций пока нет',
}: {
  operations: OperationDto[];
  emptyText?: string;
}) {
  if (operations.length === 0) {
    return <p className="py-8 text-center text-xs text-muted">{emptyText}</p>;
  }

  return (
    <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-line">
      {operations.map((operation) => {
        const Icon = icons[operation.action];
        const reason =
          typeof operation.details?.reason === 'string' ? operation.details.reason : null;

        return (
          <li key={operation.id} className="relative flex gap-3">
            <span
              className={cn(
                'relative z-10 mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ring-1 ring-inset',
                tones[operation.action],
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pb-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-xs font-semibold text-ink">
                  {OPERATION_META[operation.action].label}
                </p>
                {operation.toStatus ? <StatusBadge status={operation.toStatus} /> : null}
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {operation.actor?.name ?? 'Система'}
                <span className="mx-1.5 text-line">·</span>
                {formatDateTime(operation.createdAt)}
              </p>
              {operation.fromStatus && operation.toStatus ? (
                <p className="mt-0.5 text-[10px] text-muted/80">
                  {STATUS_META[operation.fromStatus].label} →{' '}
                  {STATUS_META[operation.toStatus].label}
                </p>
              ) : null}
              {reason ? (
                <p className="mt-1.5 rounded-lg bg-rose-50/70 px-2.5 py-1.5 text-[11px] text-rose-800">
                  Причина: {reason}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
