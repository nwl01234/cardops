import { ApiError } from '@/api/client';

export function errorMessage(error: unknown, fallback = 'Что-то пошло не так'): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'NETWORK_ERROR':
        return 'API недоступен. Проверьте соединение и demo runner.';
      case 'VALIDATION_ERROR':
        return 'Проверьте заполнение полей.';
      case 'FORBIDDEN':
        return 'Недостаточно прав для этого действия.';
      case 'NOT_FOUND':
        return 'Объект не найден или недоступен.';
      case 'CONFLICT':
        return error.message.includes('SKU')
          ? 'Карта с таким SKU уже существует.'
          : 'Конфликт данных. Обновите страницу и повторите.';
      case 'INVALID_TRANSITION':
        return 'Статус карты уже изменился. Обновите данные.';
      case 'VERSION_CONFLICT':
        return 'Карту изменил другой пользователь. Обновите и повторите.';
      case 'IDEMPOTENCY_KEY_MISMATCH':
        return 'Этот ключ идемпотентности уже использован с другим запросом.';
      case 'IDEMPOTENCY_KEY_REQUIRED':
        return 'Не передан Idempotency-Key.';
      case 'RATE_LIMITED':
        return 'Слишком много попыток. Подождите немного.';
      case 'UNAUTHORIZED':
        return 'Сессия истекла. Войдите заново.';
      default:
        return error.message || fallback;
    }
  }
  return fallback;
}
