import { NavLink } from 'react-router-dom';
import { MAIN_NAV } from './nav';
import { cn } from '@/lib/cn';

export function MobileNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <div className="grid grid-cols-4">
        {MAIN_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors',
                  isActive ? 'text-brand-800' : 'text-muted/70',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'grid h-7 w-10 place-items-center rounded-lg transition-colors',
                      isActive ? 'bg-brand-50' : 'bg-transparent',
                    )}
                  >
                    <Icon className="size-[18px]" strokeWidth={isActive ? 2.2 : 1.8} />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
