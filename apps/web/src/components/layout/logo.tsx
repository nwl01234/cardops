import { Layers3 } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Logo({
  variant = 'dark',
  compact = false,
  className,
}: {
  variant?: 'dark' | 'light';
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'grid size-9 place-items-center rounded-xl shadow-sm',
          variant === 'dark' ? 'bg-accent-400 text-brand-950' : 'bg-brand-100 text-brand-800',
        )}
      >
        <Layers3 className="size-4.5" strokeWidth={2.2} aria-hidden />
      </span>
      {!compact ? (
        <span className="leading-none">
          <span
            className={cn(
              'block text-[15px] font-bold tracking-tight',
              variant === 'dark' ? 'text-white' : 'text-ink',
            )}
          >
            CardOps
          </span>
          <span
            className={cn(
              'mt-1 block text-[9px] font-semibold uppercase tracking-[0.18em]',
              variant === 'dark' ? 'text-white/40' : 'text-muted',
            )}
          >
            operations console
          </span>
        </span>
      ) : null}
    </div>
  );
}
