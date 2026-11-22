import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Capability } from '@cardops/shared';
import { can } from '@cardops/shared';
import { useAuth } from './auth-provider';
import { PageSkeleton } from '@/components/ui/skeleton';
import { ForbiddenPage } from '@/pages/forbidden';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PageSkeleton />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  if (!can(user.role, capability)) return <ForbiddenPage />;
  return <>{children}</>;
}
