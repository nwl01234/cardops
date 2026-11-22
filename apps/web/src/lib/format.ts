const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const shortDateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
});

const relativeFormat = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function formatShortDate(iso: string): string {
  return shortDateFormat.format(new Date(iso));
}

export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSeconds = Math.round(diffMs / 1000);

  if (diffSeconds < 45) return 'только что';
  if (diffSeconds < 3_600) return relativeFormat.format(-Math.round(diffSeconds / 60), 'minute');
  if (diffSeconds < 86_400) return relativeFormat.format(-Math.round(diffSeconds / 3_600), 'hour');
  if (diffSeconds < 604_800) return relativeFormat.format(-Math.round(diffSeconds / 86_400), 'day');
  return formatDate(iso);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} сек`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} мин`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} ч`;
  return `${Math.floor(seconds / 86_400)} д`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
}

export function pluralWarehouses(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} склад`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} склада`;
  return `${count} складов`;
}

export function pluralRecords(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} запись`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} записи`;
  return `${count} записей`;
}

export function pluralCards(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} карта`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} карты`;
  return `${count} карт`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}
