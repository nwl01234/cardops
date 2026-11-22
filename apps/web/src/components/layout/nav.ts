import type { LucideIcon } from 'lucide-react';
import { Activity, LayoutDashboard, ScanLine, ScrollText, Users, WalletCards } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Обзор', icon: LayoutDashboard, end: true },
  { to: '/cards', label: 'Карты', icon: WalletCards },
  { to: '/scan', label: 'Сканер', icon: ScanLine },
  { to: '/audit', label: 'Журнал', icon: ScrollText },
];

export const SYSTEM_NAV: NavItem[] = [
  { to: '/system', label: 'Состояние системы', icon: Activity },
  { to: '/admin/users', label: 'Пользователи', icon: Users },
];

export function sectionTitle(pathname: string): string {
  if (pathname.startsWith('/cards/')) return 'Карточка';
  if (pathname.startsWith('/cards')) return 'Карты';
  if (pathname.startsWith('/audit')) return 'Журнал';
  if (pathname.startsWith('/scan')) return 'Сканер';
  if (pathname.startsWith('/system')) return 'Система';
  if (pathname.startsWith('/admin')) return 'Пользователи';
  return 'Обзор';
}
