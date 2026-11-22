import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Repositories accept either the root database or an open transaction.
 * Services pass `tx` when a change must be atomic.
 */
export type DbExecutor = Database | Transaction;

export interface DatabaseHandle {
  db: Database;
  sql: ReturnType<typeof postgres>;
  close: () => Promise<void>;
}

export interface DatabaseOptions {
  max?: number;
  onNotice?: (notice: postgres.Notice) => void;
}

export function createDatabase(url: string, options: DatabaseOptions = {}): DatabaseHandle {
  const sql = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: options.onNotice ?? (() => undefined),
  });

  const db = drizzle(sql, { schema, casing: 'snake_case' });

  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export function constraintName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const value = (error as { constraint_name?: unknown }).constraint_name;
  return typeof value === 'string' ? value : null;
}
