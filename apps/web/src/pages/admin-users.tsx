import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import type {
  AdminCreateUserInput,
  AdminUpdateUserInput,
  AdminUserDto,
  Role,
} from '@cardops/shared';
import { api } from '@/api/client';
import { useAuth } from '@/auth/auth-provider';
import { Button, IconButton } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Field, Input, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Avatar } from '@/components/ui/avatar';
import { RoleBadge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { ROLE_META } from '@/lib/labels';
import { qk } from '@/lib/query-client';
import { cn } from '@/lib/cn';

const ROLES: Role[] = ['admin', 'manager', 'warehouse'];

interface FormState {
  login: string;
  password: string;
  name: string;
  role: Role;
  warehouseId: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  login: '',
  password: '',
  name: '',
  role: 'manager',
  warehouseId: '',
  isActive: true,
};

export function AdminUsersPage() {
  useDocumentTitle('Пользователи');
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserDto | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: ({ signal }) => api.admin.users(signal),
  });
  const warehousesQuery = useQuery({
    queryKey: qk.warehouses,
    queryFn: ({ signal }) => api.directory.warehouses(signal),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            login: editing.login,
            password: '',
            name: editing.name,
            role: editing.role,
            warehouseId: editing.warehouseId ?? '',
            isActive: editing.isActive,
          }
        : emptyForm,
    );
    setFormError(null);
  }, [open, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Укажите имя');
      if (!editing && form.login.trim().length < 3) throw new Error('Логин минимум 3 символа');
      if (!editing && form.password.length < 8) throw new Error('Пароль минимум 8 символов');
      if (editing && form.password && form.password.length < 8) {
        throw new Error('Новый пароль минимум 8 символов');
      }
      if (form.role === 'warehouse' && !form.warehouseId) {
        throw new Error('Для роли warehouse выберите склад');
      }

      if (editing) {
        const input: AdminUpdateUserInput = {
          name: form.name.trim(),
          role: form.role,
          warehouseId: form.role === 'warehouse' ? form.warehouseId : null,
          isActive: form.isActive,
          ...(form.password ? { password: form.password } : {}),
        };
        return api.admin.updateUser(editing.id, input);
      }

      const input: AdminCreateUserInput = {
        login: form.login.trim().toLowerCase(),
        password: form.password,
        name: form.name.trim(),
        role: form.role,
        warehouseId: form.role === 'warehouse' ? form.warehouseId : null,
      };
      return api.admin.createUser(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        title: editing ? 'Пользователь обновлён' : 'Пользователь создан',
        description: form.login,
      });
      setOpen(false);
      setEditing(null);
    },
    onError: (error) => setFormError(errorMessage(error, 'Не удалось сохранить пользователя')),
  });

  const revokeMutation = useMutation({
    mutationFn: (userId: string) => api.admin.revokeSessions(userId),
    onSuccess: () => {
      toast({ title: 'Сессии отозваны', description: 'Пользователь будет вынужден войти заново' });
    },
    onError: (error) => toast({ title: 'Ошибка', description: errorMessage(error), tone: 'error' }),
  });

  const toggleActive = useMutation({
    mutationFn: (target: AdminUserDto) =>
      api.admin.updateUser(target.id, { isActive: !target.isActive }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        title: updated.isActive ? 'Пользователь активирован' : 'Пользователь деактивирован',
        description: updated.login,
      });
    },
    onError: (error) => toast({ title: 'Ошибка', description: errorMessage(error), tone: 'error' }),
  });

  if (!user) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Администрирование"
        title="Пользователи"
        description="Источник истины для идентичности, ролей и складов. Пароли хранятся только как Argon2id-хеши."
        actions={
          <Button
            icon={<Plus className="size-4" />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Новый пользователь
          </Button>
        }
      />

      <Panel className="overflow-hidden">
        {usersQuery.isLoading ? (
          <TableSkeleton rows={5} />
        ) : usersQuery.isError ? (
          <ErrorState
            message="Пользователи не загрузились."
            onRetry={() => void usersQuery.refetch()}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-muted">
                  <th className="px-5 py-3 font-semibold">Пользователь</th>
                  <th className="px-4 py-3 font-semibold">Роль</th>
                  <th className="px-4 py-3 font-semibold">Склад</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-4 py-3 font-semibold">Создан</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(usersQuery.data ?? []).map((item) => (
                  <tr key={item.id} className="hover:bg-brand-50/20">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={item.name} role={item.role} size="sm" />
                        <div>
                          <p className="text-xs font-semibold text-ink">{item.name}</p>
                          <p className="font-mono text-[10px] text-muted">@{item.login}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <RoleBadge role={item.role} />
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted">{item.warehouseName ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          item.isActive
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        <span className="size-1 rounded-full bg-current" />
                        {item.isActive ? 'активен' : 'отключён'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted">{formatDate(item.createdAt)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label="Изменить"
                          onClick={() => {
                            setEditing(item);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label="Отозвать сессии"
                          onClick={() => revokeMutation.mutate(item.id)}
                        >
                          <KeyRound className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label={item.isActive ? 'Деактивировать' : 'Активировать'}
                          onClick={() => toggleActive.mutate(item)}
                        >
                          {item.isActive ? (
                            <UserX className="size-3.5" />
                          ) : (
                            <UserCheck className="size-3.5" />
                          )}
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-[10px] leading-relaxed text-muted">
        <ShieldCheck className="mr-1 inline size-3 text-brand-600" />
        Деактивация и смена роли применяются без ожидания JWT: auth middleware перечитывает
        пользователя и проверяет Redis-сессию на каждом запросе. После смены пароля/роли сессии
        отзываются.
      </p>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        title={editing ? 'Изменить пользователя' : 'Новый пользователь'}
        description={
          editing
            ? 'Логин неизменяем. Пустой пароль означает «не менять».'
            : 'Пользователь сразу сможет войти с указанными данными.'
        }
        dismissible={!saveMutation.isPending}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setEditing(null);
              }}
              disabled={saveMutation.isPending}
            >
              Отмена
            </Button>
            <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
              {editing ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Логин" htmlFor="admin-login" error={formError ?? undefined}>
              <Input
                id="admin-login"
                value={form.login}
                disabled={Boolean(editing)}
                onChange={(event) => setForm({ ...form, login: event.target.value })}
                placeholder="manager2"
                className="font-mono"
              />
            </Field>
            <Field label="Имя" htmlFor="admin-name">
              <Input
                id="admin-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Имя Фамилия"
              />
            </Field>
          </div>

          <Field
            label={editing ? 'Новый пароль' : 'Пароль'}
            htmlFor="admin-password"
            hint={editing ? 'Оставьте пустым, чтобы не менять' : 'Минимум 8 символов'}
          >
            <Input
              id="admin-password"
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Роль" htmlFor="admin-role">
              <Select
                id="admin-role"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_META[role].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Склад" htmlFor="admin-warehouse">
              <Select
                id="admin-warehouse"
                value={form.warehouseId}
                disabled={form.role !== 'warehouse'}
                onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}
              >
                <option value="">—</option>
                {(warehousesQuery.data ?? []).map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} · {warehouse.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {editing ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
              Активен
            </label>
          ) : null}

          {formError ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {formError}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
