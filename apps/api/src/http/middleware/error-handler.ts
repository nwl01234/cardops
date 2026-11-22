import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { ApiErrorCode, ApiErrorPayload } from '@cardops/shared';
import { AppError } from '../../lib/errors';
import type { AppLogger } from '../../lib/logger';
import type { AppContext } from '../context';

function payload(
  code: ApiErrorPayload['error']['code'],
  message: string,
  requestId: string,
  details?: unknown,
): ApiErrorPayload {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function handleError(error: Error, c: AppContext, logger: AppLogger): Response {
  const requestId = c.get('requestId') ?? 'unknown';

  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error({ err: error, requestId, code: error.code }, 'Request failed');
    } else {
      logger.debug(
        { requestId, code: error.code, status: error.status },
        'Request rejected by domain',
      );
    }

    if (error.code === 'RATE_LIMITED' && typeof error.details === 'object' && error.details) {
      const retryAfter = (error.details as { retryAfter?: number }).retryAfter;
      if (retryAfter) c.header('Retry-After', String(retryAfter));
    }

    return c.json(
      payload(error.code, error.message, requestId, error.details),
      error.status as ContentfulStatusCode,
    );
  }

  if (error instanceof ZodError) {
    return c.json(
      payload('VALIDATION_ERROR', 'Request validation failed', requestId, {
        issues: error.issues,
      }),
      400,
    );
  }

  if (error instanceof HTTPException) {
    const byStatus: Partial<Record<number, ApiErrorCode>> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'VALIDATION_ERROR',
      429: 'RATE_LIMITED',
    };
    return c.json(
      payload(
        byStatus[error.status] ?? (error.status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR'),
        error.message || 'Request failed',
        requestId,
      ),
      error.status,
    );
  }

  logger.error({ err: error, requestId }, 'Unhandled request error');
  return c.json(payload('INTERNAL_ERROR', 'Internal server error', requestId), 500);
}
