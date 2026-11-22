import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Skeleton } from './skeleton';

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'brand',
  progress,
  loading,
  className,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  tone?: 'brand' | 'emerald' | 'sky' | 'amber' | 'rose';
  progress?: number;
  loading?: boolean;
  className?: string;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    sky: 'bg-sky-50 text-sky-700 ring-sky-100',
    amber: 'bg-amber-50 text-amber-800 ring-amber-100',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
  };

  const bars = {
    brand: 'bg-brand-500',
    emerald: 'bg-emerald-500',
    sky: 'bg-sky-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  };

  return (
    <div className={cn('panel relative overflow-hidden p-3.5 sm:p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-16" />
          ) : (
            <p className="mt-1 text-2xl font-semibold leading-none tracking-tight text-ink tabular-nums sm:text-[28px]">
              {value}
            </p>
          )}
          {hint ? <p className="mt-2 text-[11px] text-muted">{hint}</p> : null}
        </div>
        <span
          className={cn(
            'flex size-9 items-center justify-center rounded-xl ring-1 ring-inset',
            tones[tone],
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      {progress !== undefined ? (
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-black/[0.05]">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', bars[tone])}
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
