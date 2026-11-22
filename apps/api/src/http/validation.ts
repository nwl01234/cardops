import type { z } from 'zod';
import { AppError } from '../lib/errors';
import type { AppContext } from './context';
import type { FieldIssue } from '@cardops/shared';

function issuesFromZod(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}

export async function parseJson<T>(c: AppContext, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw AppError.validation([{ path: 'body', message: 'Body must be valid JSON' }]);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw AppError.validation(issuesFromZod(parsed.error));
  return parsed.data;
}

function queryObject(c: AppContext): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of new URL(c.req.url).searchParams) {
    if (value !== '') result[key] = value;
  }
  return result;
}

export function parseQuery<T>(c: AppContext, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(queryObject(c));
  if (!parsed.success) throw AppError.validation(issuesFromZod(parsed.error));
  return parsed.data;
}

export function parseParam<T>(c: AppContext, name: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(c.req.param(name));
  if (!parsed.success) {
    throw AppError.validation([
      { path: name, message: parsed.error.issues[0]?.message ?? 'Invalid path parameter' },
    ]);
  }
  return parsed.data;
}
