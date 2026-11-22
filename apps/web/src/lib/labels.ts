import type { CardStatus, OperationAction, Role, TransitionAction } from '@cardops/shared';

export interface StatusMeta {
  label: string;
  dot: string;
  badge: string;
}

export const STATUS_META: Record<CardStatus, StatusMeta> = {
  in_stock: {
    label: 'На складе',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-800 ring-emerald-200/70',
  },
  issued: {
    label: 'Выдана',
    dot: 'bg-sky-500',
    badge: 'bg-sky-50 text-sky-800 ring-sky-200/70',
  },
  returned: {
    label: 'Возвращена',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-900 ring-amber-200/70',
  },
  written_off: {
    label: 'Списана',
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-800 ring-rose-200/70',
  },
};

export const OPERATION_META: Record<
  OperationAction,
  { label: string; short: string; tone: string }
> = {
  'card.created': {
    label: 'Карта создана',
    short: 'Создание',
    tone: 'bg-slate-100 text-slate-700',
  },
  'card.issued': {
    label: 'Карта выдана',
    short: 'Выдача',
    tone: 'bg-sky-50 text-sky-800',
  },
  'card.returned': {
    label: 'Карта возвращена',
    short: 'Возврат',
    tone: 'bg-amber-50 text-amber-900',
  },
  'card.restocked': {
    label: 'Карта возвращена на склад',
    short: 'Приёмка',
    tone: 'bg-emerald-50 text-emerald-800',
  },
  'card.written_off': {
    label: 'Карта списана',
    short: 'Списание',
    tone: 'bg-rose-50 text-rose-800',
  },
};

export const ROLE_META: Record<Role, { label: string; short: string }> = {
  admin: { label: 'Администратор', short: 'Admin' },
  manager: { label: 'Менеджер', short: 'Manager' },
  warehouse: { label: 'Сотрудник склада', short: 'Warehouse' },
};

export const TRANSITION_META: Record<
  TransitionAction,
  { label: string; button: string; description: string; confirmTitle: string }
> = {
  issue: {
    label: 'Выдать',
    button: 'Выдать карту',
    description: 'Карта перейдёт менеджеру и появится в его кабинете.',
    confirmTitle: 'Выдача карты',
  },
  return: {
    label: 'Вернуть',
    button: 'Вернуть карту',
    description: 'Текущий держатель снимется, карта получит статус «Возвращена».',
    confirmTitle: 'Возврат карты',
  },
  restock: {
    label: 'На склад',
    button: 'Вернуть на склад',
    description: 'Карта снова станет доступна для выдачи.',
    confirmTitle: 'Приёмка на склад',
  },
  write_off: {
    label: 'Списать',
    button: 'Списать карту',
    description: 'Необратимое действие. Причина попадёт в журнал.',
    confirmTitle: 'Списание карты',
  },
};

export const AUDIT_ACTION_OPTIONS = [
  { value: '', label: 'Все действия' },
  { value: 'card.created', label: 'Создание' },
  { value: 'card.issued', label: 'Выдача' },
  { value: 'card.returned', label: 'Возврат' },
  { value: 'card.restocked', label: 'Приёмка на склад' },
  { value: 'card.written_off', label: 'Списание' },
] as const;
