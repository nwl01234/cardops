import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonStyles } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
        <Compass className="size-6" aria-hidden />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Страница не найдена</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        Такого маршрута нет. Возможно, ссылка устарела или карточка была перемещена.
      </p>
      <Link to="/" className={buttonStyles('primary', 'md') + ' mt-5'}>
        На обзор
      </Link>
    </div>
  );
}
