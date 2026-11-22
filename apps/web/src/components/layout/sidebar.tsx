import type { UserDto } from '@cardops/shared';
import { can } from '@cardops/shared';
import { LogOut, X } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/auth-provider';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { ROLE_META } from '@/lib/labels';
import { Logo } from './logo';
import { MAIN_NAV, SYSTEM_NAV, type NavItem } from './nav';

function NavLinkItem({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-white/[0.09] text-white'
            : 'text-white/55 hover:bg-white/[0.05] hover:text-white/90',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent-400" />
          ) : null}
          <Icon
            className={cn('size-4', isActive ? 'text-accent-400' : 'text-white/40')}
            strokeWidth={1.9}
            aria-hidden
          />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function SidebarBody({ user, onNavigate }: { user: UserDto; onNavigate?: () => void }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true, state: { from: '/' } });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">
          Рабочее пространство
        </p>
        <div className="space-y-0.5">
          {MAIN_NAV.map((item) => (
            <NavLinkItem key={item.to} item={item} onNavigate={onNavigate} />
          ))}
        </div>

        {can(user.role, 'system.read') ? (
          <>
            <p className="px-3 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">
              Система
            </p>
            <div className="space-y-0.5">
              {SYSTEM_NAV.map((item) => (
                <NavLinkItem key={item.to} item={item} onNavigate={onNavigate} />
              ))}
            </div>
          </>
        ) : null}

        <div className="mx-3 mt-7 rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
          <div className="flex items-center gap-2">
            <span className="live-dot size-1.5 rounded-full bg-emerald-400" />
            <p className="text-[11px] font-semibold text-white/70">Демо-стенд</p>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-white/50">
            PostgreSQL · Hono · WebSocket
            <br />
            все данные можно пересоздать
          </p>
        </div>
      </nav>

      <div className="border-t border-white/[0.07] p-3">
        <div className="flex items-center gap-2.5 rounded-xl p-2">
          <Avatar name={user.name} role={user.role} size="sm" className="bg-white/10 text-white" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white/90">{user.name}</p>
            <p className="truncate text-[10px] text-white/40">
              {ROLE_META[user.role].label}
              {user.warehouseName ? ` · ${user.warehouseName.split('·')[0]?.trim()}` : ''}
            </p>
          </div>
          <IconButton
            label="Выйти"
            onClick={() => void onLogout()}
            className="text-white/40 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ user }: { user: UserDto }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-brand-950 lg:block">
      <div className="dot-grid absolute inset-0 opacity-30" aria-hidden />
      <div className="relative h-full">
        <SidebarBody user={user} />
      </div>
    </aside>
  );
}

export function MobileMenu({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: UserDto;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Меню"
        className="animate-enter absolute inset-y-0 left-0 w-[280px] bg-brand-950 shadow-lift"
      >
        <div className="dot-grid absolute inset-0 opacity-30" aria-hidden />
        <div className="relative h-full">
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Закрыть меню"
            className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
          <SidebarBody user={user} onNavigate={onClose} />
        </div>
      </aside>
    </div>
  );
}
