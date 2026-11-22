import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from './button';

export function ErrorState({
  title = 'Не удалось загрузить данные',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-100">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {message ? <p className="mt-1 max-w-md text-xs text-muted">{message}</p> : null}
      {onRetry ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          icon={<RotateCcw className="size-3.5" />}
          onClick={onRetry}
        >
          Повторить
        </Button>
      ) : null}
    </div>
  );
}
