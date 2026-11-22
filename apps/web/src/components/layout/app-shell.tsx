import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/auth-provider';
import { RealtimeProvider } from '@/realtime/realtime-provider';
import { PageSkeleton } from '@/components/ui/skeleton';
import { MobileMenu, Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { MobileNav } from './mobile-nav';

export function AppShell() {
  const { user } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (!user) return null;

  return (
    <RealtimeProvider>
      <div className="min-h-dvh bg-canvas">
        <Sidebar user={user} />
        <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} user={user} />

        <div className="lg:pl-64">
          <Topbar user={user} onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
          <main className="mx-auto w-full max-w-[1320px] px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:py-8">
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </main>
        </div>

        <MobileNav />
      </div>
    </RealtimeProvider>
  );
}
