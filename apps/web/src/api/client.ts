import type {
  AdminCreateUserInput,
  AdminUpdateUserInput,
  AdminUserDto,
  ApiErrorCode,
  ApiErrorPayload,
  AuditQuery,
  CardDetailDto,
  CardDto,
  CardListQuery,
  CreateCardInput,
  CursorPage,
  DashboardDto,
  LoginInput,
  MutationResult,
  OcrResultDto,
  OperationDto,
  Page,
  ScanRequest,
  SystemHealthDto,
  TransitionInput,
  UserDto,
  WarehouseDto,
} from '@cardops/shared';

export class ApiError extends Error {
  readonly code: ApiErrorCode | 'NETWORK_ERROR';
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    code: ApiErrorCode | 'NETWORK_ERROR',
    message: string,
    status: number,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  retriedAuth?: boolean;
}

async function refreshSession(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 'Нет связи с API', 0);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError('INTERNAL_ERROR', 'Некорректный ответ API', response.status);
    }
  }

  if (!response.ok) {
    const noRefreshPaths = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);
    if (
      response.status === 401 &&
      !options.retriedAuth &&
      !noRefreshPaths.has(path) &&
      (await refreshSession())
    ) {
      return request<T>(path, { ...options, retriedAuth: true });
    }

    const errorBody = payload as ApiErrorPayload | null;
    const error = errorBody?.error;
    throw new ApiError(
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? `HTTP ${response.status}`,
      response.status,
      error?.details,
      error?.requestId,
    );
  }

  return payload as T;
}

function unwrap<T>(payload: { data: T }): T {
  return payload.data;
}

export const api = {
  auth: {
    async me(signal?: AbortSignal): Promise<UserDto> {
      const body = unwrap(await request<{ data: { user: UserDto } }>('/auth/me', { signal }));
      return body.user;
    },
    async login(input: LoginInput): Promise<{ user: UserDto; expiresIn: number }> {
      return unwrap(
        await request<{ data: { user: UserDto; expiresIn: number } }>('/auth/login', {
          method: 'POST',
          body: input,
        }),
      );
    },
    async logout(): Promise<void> {
      await request('/auth/logout', { method: 'POST' });
    },
    async realtimeTicket(): Promise<void> {
      await request('/auth/realtime-ticket', { method: 'POST' });
    },
  },

  dashboard: {
    async get(signal?: AbortSignal): Promise<DashboardDto> {
      return unwrap(await request<{ data: DashboardDto }>('/dashboard', { signal }));
    },
  },

  cards: {
    async list(query: Partial<CardListQuery>, signal?: AbortSignal): Promise<Page<CardDto>> {
      const params = new URLSearchParams();
      if (query.status) params.set('status', query.status);
      if (query.warehouseId) params.set('warehouseId', query.warehouseId);
      if (query.q) params.set('q', query.q);
      if (query.mine) params.set('mine', 'true');
      if (query.page) params.set('page', String(query.page));
      if (query.pageSize) params.set('pageSize', String(query.pageSize));
      return unwrap(
        await request<{ data: Page<CardDto> }>(`/cards?${params.toString()}`, { signal }),
      );
    },
    async get(id: string, signal?: AbortSignal): Promise<CardDetailDto> {
      return unwrap(await request<{ data: CardDetailDto }>(`/cards/${id}`, { signal }));
    },
    async create(input: CreateCardInput, idempotencyKey: string): Promise<MutationResult<CardDto>> {
      return request<MutationResult<CardDto>>('/cards', {
        method: 'POST',
        body: input,
        idempotencyKey,
      });
    },
    async transition(
      id: string,
      input: TransitionInput,
      idempotencyKey: string,
    ): Promise<MutationResult<CardDetailDto>> {
      return request<MutationResult<CardDetailDto>>(`/cards/${id}/transitions`, {
        method: 'POST',
        body: input,
        idempotencyKey,
      });
    },
    async scan(input: ScanRequest): Promise<CardDto> {
      return unwrap(
        await request<{ data: CardDto }>('/scan', {
          method: 'POST',
          body: input,
        }),
      );
    },
  },

  audit: {
    async list(query: AuditQuery, signal?: AbortSignal): Promise<CursorPage<OperationDto>> {
      const params = new URLSearchParams();
      if (query.cardId) params.set('cardId', query.cardId);
      if (query.action) params.set('action', query.action);
      if (query.limit) params.set('limit', String(query.limit));
      if (query.before) params.set('before', query.before);
      return unwrap(
        await request<{ data: CursorPage<OperationDto> }>(`/audit?${params.toString()}`, {
          signal,
        }),
      );
    },
  },

  directory: {
    async warehouses(signal?: AbortSignal): Promise<WarehouseDto[]> {
      return unwrap(await request<{ data: WarehouseDto[] }>('/warehouses', { signal }));
    },
    async users(role: 'manager' | 'admin' | 'warehouse', signal?: AbortSignal): Promise<UserDto[]> {
      return unwrap(await request<{ data: UserDto[] }>(`/users?role=${role}`, { signal }));
    },
  },

  scan: {
    async ocr(file: File): Promise<OcrResultDto> {
      const form = new FormData();
      form.append('image', file);
      const response = await fetch('/ocr-api/ocr', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: OcrResultDto;
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.data) {
        throw new ApiError(
          'INTERNAL_ERROR',
          payload?.error?.message ?? 'OCR failed',
          response.status,
        );
      }
      return payload.data;
    },
  },

  admin: {
    async users(signal?: AbortSignal): Promise<AdminUserDto[]> {
      return unwrap(await request<{ data: AdminUserDto[] }>('/admin/users', { signal }));
    },
    async createUser(input: AdminCreateUserInput): Promise<AdminUserDto> {
      return unwrap(
        await request<{ data: AdminUserDto }>('/admin/users', {
          method: 'POST',
          body: input,
        }),
      );
    },
    async updateUser(id: string, input: AdminUpdateUserInput): Promise<AdminUserDto> {
      return unwrap(
        await request<{ data: AdminUserDto }>(`/admin/users/${id}`, {
          method: 'PATCH',
          body: input,
        }),
      );
    },
    async revokeSessions(id: string): Promise<void> {
      await request(`/admin/users/${id}/revoke-sessions`, { method: 'POST' });
    },
  },

  system: {
    async get(signal?: AbortSignal): Promise<SystemHealthDto> {
      return unwrap(await request<{ data: SystemHealthDto }>('/system', { signal }));
    },
  },
};
