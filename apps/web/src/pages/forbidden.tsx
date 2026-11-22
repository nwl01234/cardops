import { ShieldX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonStyles } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

export function ForbiddenPage() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="403" title="Доступ закрыт" />
      <div className="panel flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-100">
          <ShieldX className="size-6" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">Недостаточно прав</h2>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
          Интерфейс скрывает недоступные действия, но окончательное решение принимает API. Эта роль
          не имеет доступа к разделу или объекту.
        </p>
        <Link to="/" className={buttonStyles('primary', 'md') + ' mt-5'}>
          Вернуться на обзор
        </Link>
      </div>
    </div>
  );
}
