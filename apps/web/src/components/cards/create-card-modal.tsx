import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCardInput, UserDto, WarehouseDto } from '@cardops/shared';
import { can } from '@cardops/shared';
import { api } from '@/api/client';
import { errorMessage } from '@/lib/errors';
import { newIdempotencyKey } from '@/lib/idempotency';
import { qk } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';

const schema = z.object({
  title: z.string().trim().min(2, 'Минимум 2 символа').max(120, 'Слишком длинно'),
  sku: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || /^[A-Za-z0-9][A-Za-z0-9-]{3,23}$/.test(value),
      '4–24 символа: A-Z, 0-9, дефис',
    ),
  warehouseId: z.string().min(1, 'Выберите склад'),
  ownerId: z.string(),
  last4: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d{4}$/.test(value), 'Ровно 4 цифры'),
  notes: z.string().max(500, 'Максимум 500 символов'),
});

type FormValues = z.infer<typeof schema>;

interface CreateCardModalProps {
  open: boolean;
  onClose: () => void;
  user: UserDto;
  warehouses: WarehouseDto[];
  defaultWarehouseId?: string;
}

export function CreateCardModal({
  open,
  onClose,
  user,
  warehouses,
  defaultWarehouseId,
}: CreateCardModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const draft = useRef<{ key: string; signature: string } | null>(null);
  const canAssignOwner = can(user.role, 'card.create');

  const managersQuery = useQuery({
    queryKey: qk.users('manager'),
    queryFn: ({ signal }) => api.directory.users('manager', signal),
    enabled: open && canAssignOwner,
    staleTime: 30_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      sku: '',
      warehouseId: defaultWarehouseId ?? user.warehouseId ?? '',
      ownerId: '',
      last4: '',
      notes: '',
    },
  });

  const wasOpen = useRef(false);

  const mutation = useMutation({
    mutationFn: (vars: { key: string; input: CreateCardInput }) =>
      api.cards.create(vars.input, vars.key),
    onSuccess: (result, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['cards'] });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });

      if (result.meta.replayed) {
        toast({
          title: 'Повторный запрос — эффекта нет',
          description: `Карта ${result.data.sku} уже создана ранее. API вернул сохранённый ответ.`,
          tone: 'info',
        });
      } else {
        toast({
          title: 'Карта создана',
          description: `${result.data.sku} · ${result.data.title}`,
          duration: 8_000,
          action: {
            label: 'Повторить запрос',
            onClick: () => mutation.mutate({ key: vars.key, input: vars.input }),
          },
        });
      }

      draft.current = null;
      onClose();
      reset();
    },
  });

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    mutation.reset();
    reset({
      title: '',
      sku: '',
      warehouseId: defaultWarehouseId ?? user.warehouseId ?? warehouses[0]?.id ?? '',
      ownerId: '',
      last4: '',
      notes: '',
    });
    // Intentionally only on the closed -> open transition; a background
    // warehouses refetch must not wipe the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = (values: FormValues) => {
    const input: CreateCardInput = {
      title: values.title,
      warehouseId: values.warehouseId,
      sku: values.sku ? values.sku.toUpperCase() : undefined,
      ownerId: values.ownerId || null,
      last4: values.last4 || undefined,
      notes: values.notes || undefined,
    };
    const signature = JSON.stringify(input);
    if (!draft.current || draft.current.signature !== signature) {
      draft.current = { key: newIdempotencyKey('create'), signature };
    }
    mutation.mutate({ key: draft.current.key, input });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!mutation.isPending}
      title="Новая карта"
      description="Создание фиксируется в журнале и отправляет событие в dashboard."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button type="submit" form="create-card-form" loading={mutation.isPending}>
            Создать карту
          </Button>
        </>
      }
    >
      <form
        id="create-card-form"
        className="space-y-4"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        <Field label="Название" htmlFor="card-title" error={errors.title?.message}>
          <Input
            id="card-title"
            placeholder="Например, Карта «Витрина»"
            data-autofocus
            invalid={Boolean(errors.title)}
            {...register('title')}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="SKU"
            htmlFor="card-sku"
            error={errors.sku?.message}
            hint="Пусто — сгенерируем автоматически"
          >
            <Input
              id="card-sku"
              placeholder="CRD-XXXX-XXXX"
              className="font-mono uppercase"
              invalid={Boolean(errors.sku)}
              {...register('sku')}
            />
          </Field>

          <Field label="Последние 4 цифры" htmlFor="card-last4" error={errors.last4?.message}>
            <Input
              id="card-last4"
              inputMode="numeric"
              maxLength={4}
              placeholder="4242"
              className="font-mono"
              invalid={Boolean(errors.last4)}
              {...register('last4')}
            />
          </Field>
        </div>

        <Field label="Склад" htmlFor="card-warehouse" error={errors.warehouseId?.message}>
          <Select
            id="card-warehouse"
            disabled={user.role === 'warehouse'}
            invalid={Boolean(errors.warehouseId)}
            {...register('warehouseId')}
          >
            <option value="">Выберите склад</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </Select>
        </Field>

        {canAssignOwner ? (
          <Field
            label="Ответственный менеджер"
            htmlFor="card-owner"
            hint="Можно назначить позже при выдаче"
          >
            <Select id="card-owner" {...register('ownerId')}>
              <option value="">Без владельца</option>
              {(managersQuery.data ?? []).map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name} · {manager.login}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Заметка" htmlFor="card-notes" error={errors.notes?.message}>
          <Textarea
            id="card-notes"
            placeholder="Контекст, который пригодится складу"
            {...register('notes')}
          />
        </Field>

        {mutation.error ? (
          <p
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
            role="alert"
          >
            {errorMessage(mutation.error, 'Не удалось создать карту')}
          </p>
        ) : null}

        <p className="text-[11px] leading-relaxed text-muted">
          Полный номер карты не передаётся и не хранится: только маска последних четырёх цифр.
        </p>
      </form>
    </Modal>
  );
}
