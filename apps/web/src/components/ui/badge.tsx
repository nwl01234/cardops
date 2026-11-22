import type { ReactNode } from 'react';
import type { CardStatus, Role } from '@cardops/shared';
import { ROLE_META, STATUS_META } from '@/lib/labels';
import { cn } from '@/lib/cn';

export function StatusBadge({ status, className }: { status: CardStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset',
        meta.badge,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  const tones: Record<Role, string> = {
    admin: 'bg-brand-50 text-brand-800 ring-brand-200/70',
    manager: 'bg-sky-50 text-sky-800 ring-sky-200/70',
    warehouse: 'bg-amber-50 text-amber-900 ring-amber-200/70',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
        tones[role],
        className,
      )}
    >
      {ROLE_META[role].short}
    </span>
  );
}

export function NeutralBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
