import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
  action?: ToastAction;
}

interface ToastRecord extends ToastInput {
  id: number;
  tone: ToastTone;
  duration: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneStyles: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-brand-700' },
  error: { icon: AlertCircle, className: 'text-rose-600' },
  info: { icon: Info, className: 'text-sky-600' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<number, number>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const record: ToastRecord = {
        ...input,
        id,
        tone: input.tone ?? 'success',
        duration: input.duration ?? 4_500,
      };
      setToasts((current) => [...current.slice(-3), record]);

      if (record.duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), record.duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const timersMap = timers.current;
    return () => {
      for (const timer of timersMap.values()) window.clearTimeout(timer);
      timersMap.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-24 z-[70] flex flex-col items-stretch gap-2 sm:bottom-6 sm:left-auto sm:w-[380px]"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((item) => {
          const tone = toneStyles[item.tone];
          const Icon = tone.icon;
          return (
            <div
              key={item.id}
              className="animate-enter pointer-events-auto flex items-start gap-3 rounded-2xl border border-line bg-white p-4 shadow-lift"
              role="status"
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', tone.className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.description}</p>
                ) : null}
                {item.action ? (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
                    onClick={() => {
                      item.action?.onClick();
                      dismiss(item.id);
                    }}
                  >
                    {item.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Закрыть уведомление"
                className="rounded-md p-0.5 text-muted transition-colors hover:bg-black/[0.04] hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
