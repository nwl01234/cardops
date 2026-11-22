import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireCapability } from '@/auth/require-auth';
import { AppShell } from '@/components/layout/app-shell';
import { LoginPage } from '@/pages/login';
import { ForbiddenPage } from '@/pages/forbidden';
import { NotFoundPage } from '@/pages/not-found';

const DashboardPage = lazy(() =>
  import('@/pages/dashboard').then((module) => ({ default: module.DashboardPage })),
);
const CardsPage = lazy(() =>
  import('@/pages/cards').then((module) => ({ default: module.CardsPage })),
);
const CardDetailPage = lazy(() =>
  import('@/pages/card-detail').then((module) => ({ default: module.CardDetailPage })),
);
const AuditPage = lazy(() =>
  import('@/pages/audit').then((module) => ({ default: module.AuditPage })),
);
const ScanPage = lazy(() =>
  import('@/pages/scan').then((module) => ({ default: module.ScanPage })),
);
const SystemPage = lazy(() =>
  import('@/pages/system').then((module) => ({ default: module.SystemPage })),
);
const AdminUsersPage = lazy(() =>
  import('@/pages/admin-users').then((module) => ({ default: module.AdminUsersPage })),
);

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="cards" element={<CardsPage />} />
        <Route path="cards/:id" element={<CardDetailPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="scan" element={<ScanPage />} />
        <Route
          path="system"
          element={
            <RequireCapability capability="system.read">
              <SystemPage />
            </RequireCapability>
          }
        />
        <Route
          path="admin/users"
          element={
            <RequireCapability capability="user.manage">
              <AdminUsersPage />
            </RequireCapability>
          }
        />
        <Route path="403" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
