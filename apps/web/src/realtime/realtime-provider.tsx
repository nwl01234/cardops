import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@cardops/shared';
import { api } from '@/api/client';
import { useAuth } from '@/auth/auth-provider';
import { useToast } from '@/components/ui/toast';
import { OPERATION_META } from '@/lib/labels';
import { qk } from '@/lib/query-client';

type RealtimeStatus = 'connecting' | 'open' | 'closed';

interface RealtimeContextValue {
  status: RealtimeStatus;
  lastEvent: RealtimeEvent | null;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  status: 'closed',
  lastEvent: null,
});

type ServerMessage =
  | { type: 'ready'; at: string }
  | { type: 'ping'; at: string }
  | { type: 'pong'; at: string }
  | { type: 'event'; event: RealtimeEvent };

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const seenEvents = useRef(new Set<string>());

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (seenEvents.current.has(event.id)) return;
      seenEvents.current.add(event.id);
      if (seenEvents.current.size > 200) {
        const oldest = seenEvents.current.values().next().value;
        if (oldest) seenEvents.current.delete(oldest);
      }

      setLastEvent(event);
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: ['cards'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      void queryClient.invalidateQueries({ queryKey: qk.card(event.card.id) });

      // The acting user already gets the mutation toast. Realtime is for
      // other sessions/roles, otherwise every action produces two toasts.
      if (event.actor?.id !== user?.id) {
        toast({
          title: OPERATION_META[event.type].label,
          description: `${event.actor?.name ?? 'Система'} · ${event.card.sku}`,
          tone: 'info',
          duration: 3_500,
        });
      }
    },
    [queryClient, toast, user?.id],
  );

  useEffect(() => {
    if (!user) {
      setStatus('closed');
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (disposed) return;
      attempt += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5));
      reconnectTimer = window.setTimeout(() => void connect(), delay + Math.random() * 400);
    };

    const connect = async () => {
      if (disposed) return;
      setStatus('connecting');

      try {
        // The ticket is written as an HttpOnly cookie at Path=/ws, so it never
        // appears in the WebSocket URL or proxy access logs.
        await api.auth.realtimeTicket();
      } catch {
        setStatus('closed');
        scheduleReconnect();
        return;
      }
      if (disposed) return;

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

      socket.addEventListener('open', () => {
        attempt = 0;
        setStatus('open');
      });

      socket.addEventListener('message', (message) => {
        try {
          const payload = JSON.parse(String(message.data)) as ServerMessage;
          if (payload.type === 'event') onEvent(payload.event);
          if (payload.type === 'ready') setStatus('open');
        } catch {
          // Unknown frame: ignore, the REST API remains the source of truth.
        }
      });

      socket.addEventListener('close', () => {
        if (disposed) return;
        setStatus('closed');
        scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        socket?.close();
      });
    };

    void connect();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [user?.id, onEvent]);

  return (
    <RealtimeContext.Provider value={{ status, lastEvent }}>{children}</RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
