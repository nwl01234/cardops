import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginInput, UserDto } from '@cardops/shared';
import { api } from '@/api/client';
import { qk } from '@/lib/query-client';

interface AuthContextValue {
  user: UserDto | null;
  isLoading: boolean;
  isLoggingIn: boolean;
  login: (input: LoginInput) => Promise<UserDto>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const meQuery = useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => api.auth.me(signal),
    retry: false,
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: (input: LoginInput) => api.auth.login(input),
    onSuccess: (result) => {
      queryClient.setQueryData(qk.me, result.user);
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.auth.logout(),
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(qk.me, null);
    },
  });

  const login = useCallback(
    async (input: LoginInput) => {
      const result = await loginMutation.mutateAsync(input);
      return result.user;
    },
    [loginMutation],
  );

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // The cookie may already be expired (or the API may be down). Local
      // session state is cleared in onSettled; logout should never trap the UI.
    }
  }, [logoutMutation]);

  useEffect(() => {
    const onUnauthorized = () => {
      queryClient.clear();
      queryClient.setQueryData(qk.me, null);
      if (window.location.pathname !== '/login') {
        navigate('/login', { replace: true });
      }
    };
    window.addEventListener('cardops:unauthorized', onUnauthorized);
    return () => window.removeEventListener('cardops:unauthorized', onUnauthorized);
  }, [navigate, queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user: meQuery.data ?? null,
        isLoading: meQuery.isLoading,
        isLoggingIn: loginMutation.isPending,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
