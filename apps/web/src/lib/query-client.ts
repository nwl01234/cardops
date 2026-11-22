import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';

function reportUnauthorized(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    window.dispatchEvent(new Event('cardops:unauthorized'));
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportUnauthorized }),
  mutationCache: new MutationCache({ onError: reportUnauthorized }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export const qk = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  cards: (filters: Record<string, unknown>) => ['cards', filters] as const,
  card: (id: string) => ['card', id] as const,
  audit: (filters: Record<string, unknown>) => ['audit', filters] as const,
  warehouses: ['warehouses'] as const,
  users: (role: string) => ['users', role] as const,
  system: ['system'] as const,
};
