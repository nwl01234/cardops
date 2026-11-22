import type { Role } from '@cardops/shared';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

const tones: Record<Role, string> = {
  admin: 'bg-brand-100 text-brand-900',
  manager: 'bg-sky-100 text-sky-900',
  warehouse: 'bg-amber-100 text-amber-900',
};

export function Avatar({
  name,
  role = 'manager',
  size = 'md',
  className,
}: {
  name: string;
  role?: Role;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const sizes = {
    xs: 'size-6 text-[9px]',
    sm: 'size-8 text-[10px]',
    md: 'size-9 text-xs',
  };

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-wide',
        sizes[size],
        tones[role],
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
