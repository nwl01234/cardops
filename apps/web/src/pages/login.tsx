import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, GitBranch, Radio, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '@/auth/auth-provider';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Logo } from '@/components/layout/logo';
import { ROLE_META } from '@/lib/labels';
import { cn } from '@/lib/cn';
import type { Role } from '@cardops/shared';

const schema = z.object({
  login: z.string().trim().min(3, 'Минимум 3 символа'),
  password: z.string().min(8, 'Минимум 8 символов'),
});

type FormValues = z.infer<typeof schema>;

const demoAccounts: Array<{
  role: Role;
  login: string;
  password: string;
  note: string;
}> = [
  { role: 'admin', login: 'admin', password: 'admin123', note: 'Все склады и операции' },
  { role: 'manager', login: 'manager', password: 'manager123', note: 'Только закреплённые карты' },
  { role: 'warehouse', login: 'warehouse', password: 'warehouse123', note: 'Склад WH-MSK' },
];

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS') return 'Неверный логин или пароль.';
    if (error.code === 'RATE_LIMITED') return 'Слишком много попыток. Подождите пару минут.';
    if (error.code === 'NETWORK_ERROR')
      return 'API недоступен. Проверьте, что запущен demo runner.';
  }
  return 'Не удалось войти. Попробуйте ещё раз.';
}

export function LoginPage() {
  const { user, login, isLoggingIn } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { login: 'admin', password: 'admin123' },
  });

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await login(values);
      navigate('/', { replace: true });
    } catch (error) {
      setServerError(loginErrorMessage(error));
    }
  };

  const quickLogin = async (account: (typeof demoAccounts)[number]) => {
    setServerError(null);
    setValue('login', account.login);
    setValue('password', account.password);
    try {
      await login({ login: account.login, password: account.password });
      navigate('/', { replace: true });
    } catch (error) {
      setServerError(loginErrorMessage(error));
    }
  };

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-brand-950 px-10 py-10 text-white lg:flex lg:flex-col xl:px-14">
        <div className="dot-grid absolute inset-0 opacity-30" aria-hidden />
        <div
          className="absolute -right-24 top-1/3 size-[420px] rounded-full bg-brand-500/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-1 flex-col">
          <Logo />

          <div className="mt-auto max-w-lg pb-8">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
              <Sparkles className="size-3 text-accent-400" />
              внутренний контур учёта
            </span>
            <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.08] tracking-tight xl:text-[44px]">
              Карты, склад и операции — без слепых зон.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/55">
              Один экран для выдачи, возврата и списания. Каждое изменение — в транзакции, с аудитом
              и мгновенным обновлением дашборда.
            </p>

            <div className="mt-9 grid gap-4">
              {[
                {
                  icon: ShieldCheck,
                  title: 'RBAC + object scope',
                  text: 'Роль отвечает за действие, склад и владелец — за объект.',
                },
                {
                  icon: GitBranch,
                  title: 'Транзакции и идемпотентность',
                  text: 'Повтор выдачи не создаёт второй эффект и вторую запись в журнале.',
                },
                {
                  icon: Radio,
                  title: 'Realtime после commit',
                  text: 'WebSocket сообщает об изменении только после успешной фиксации.',
                },
              ].map((item) => (
                <div key={item.title} className="flex gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-accent-400 ring-1 ring-white/10">
                    <item.icon className="size-3.5" strokeWidth={2} />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-white/90">{item.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-white/60">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative border-t border-white/10 pt-6">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">
              Демо-доступы
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {demoAccounts.map((account) => (
                <button
                  key={account.login}
                  type="button"
                  onClick={() => void quickLogin(account)}
                  disabled={isLoggingIn}
                  className="group rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-accent-400/40 hover:bg-white/[0.06] disabled:opacity-50"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-400">
                    {ROLE_META[account.role].short}
                  </span>
                  <span className="mt-1 block font-mono text-[11px] text-white/80">
                    {account.login}
                  </span>
                  <span className="mt-1 block text-[10px] leading-snug text-white/50">
                    {account.note}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="flex min-h-dvh flex-col px-5 py-6 sm:px-10 lg:px-12">
        <div className="flex items-center justify-between lg:hidden">
          <Logo variant="light" />
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold text-brand-700">
            demo
          </span>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-700">
              Вход в систему
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">С возвращением</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Используйте демо-аккаунт или введите логин вручную.
            </p>
          </div>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <Field label="Логин" htmlFor="login" error={errors.login?.message}>
              <Input
                id="login"
                autoComplete="username"
                placeholder="admin"
                invalid={Boolean(errors.login)}
                {...register('login')}
              />
            </Field>

            <Field label="Пароль" htmlFor="password" error={errors.password?.message}>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  invalid={Boolean(errors.password)}
                  className="pr-10"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            {serverError ? (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
              >
                {serverError}
              </div>
            ) : null}

            <Button type="submit" size="lg" className="w-full" loading={isLoggingIn}>
              Войти
              <ArrowRight className="size-4" />
            </Button>
          </form>

          <div className="mt-8 rounded-2xl border border-line bg-white/60 p-4 lg:hidden">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              Быстрый вход
            </p>
            <div className="grid gap-1.5">
              {demoAccounts.map((account) => (
                <button
                  key={account.login}
                  type="button"
                  onClick={() => void quickLogin(account)}
                  disabled={isLoggingIn}
                  className={cn(
                    'flex items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-brand-50',
                  )}
                >
                  <span className="font-mono text-xs text-ink">{account.login}</span>
                  <span className="text-[10px] text-muted">{ROLE_META[account.role].label}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-8 text-[11px] leading-relaxed text-muted/70">
            Cookie-сессия HttpOnly · JWT · PostgreSQL. Пароли демо-пользователей
            <span className="font-mono"> admin123 / manager123 / warehouse123</span>.
          </p>
        </div>
      </section>
    </div>
  );
}
