import type { UserDto } from '@cardops/shared';
import { Menu } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/auth-provider';
import { useRealtime } from '@/realtime/realtime-provider';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { LogOut } from 'lucide-react';
import { sectionTitle } from './nav';

const statusMeta = {
  open: {
    label: 'live',
    className: 'text-brand-700 bg-brand-50 ring-brand-200/60',
    dot: 'bg-emerald-500',
  },
  connecting: {
    label: 'sync',
    className: 'text-amber-800 bg-amber-50 ring-amber-200/60',
    dot: 'bg-amber-500',
  },
  closed: {
    label: 'offline',
    className: 'text-muted bg-black/[0.04] ring-line',
    dot: 'bg-slate-400',
  },
} as const;

export function LiveStatus() {
  const { status } = useRealtime();
  const meta = statusMeta[status];

  return (
    <span
      title="Обновления по WebSocket"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset',
        meta.className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', meta.dot, status === 'open' && 'live-dot')} />
      <span className="hidden sm:inline">{meta.label}</span>
    </span>
  );
}

export function Topbar({
  user,
  onMenu,
  menuOpen,
}: {
  user: UserDto;
  onMenu: () => void;
  menuOpen: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const today = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true, state: { from: '/' } });
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line/80 bg-canvas/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <IconButton
        label="Открыть меню"
        onClick={onMenu}
        aria-expanded={menuOpen}
        aria-controls="mobile-menu"
        className="lg:hidden"
      >
        <Menu className="size-5" />
      </IconButton>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-muted">
          CardOps <span className="mx-1.5 text-line">/</span>
          <span className="font-semibold text-ink">{sectionTitle(location.pathname)}</span>
        </p>
        <p className="hidden text-[10px] text-muted sm:block">{today}</p>
      </div>

      <LiveStatus />

      <div className="hidden h-6 w-px bg-line sm:block" />

      <div className="hidden items-center gap-2 sm:flex">
        <Avatar name={user.name} role={user.role} size="sm" />
        <div className="hidden md:block">
          <p className="max-w-36 truncate text-xs font-semibold text-ink">{user.name}</p>
          <p className="text-[10px] text-muted">
            {user.warehouseName ?? (user.role === 'admin' ? 'Все склады' : 'Личный кабинет')}
          </p>
        </div>
      </div>

      <IconButton label="Выйти" onClick={() => void onLogout()} className="hidden lg:inline-flex">
        <LogOut className="size-4" />
      </IconButton>
    </header>
  );
}
