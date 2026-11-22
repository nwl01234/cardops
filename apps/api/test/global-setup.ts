import { loadConfig } from '../src/config/env';
import { runMigrations } from '../src/db/migrator';

function assertDisposableDatabase(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  const explicitTestUrl = Boolean(process.env.TEST_DATABASE_URL);
  const looksDisposable = /(^|[_-])test($|[_-])/i.test(parsed.pathname) || parsed.port === '55433';
  if (!explicitTestUrl && !looksDisposable) {
    throw new Error(
      `Refusing to run destructive tests against ${parsed.hostname}:${parsed.port}${parsed.pathname}. ` +
        'Use `npm test` from the repo root (it sets TEST_DATABASE_URL), or set ' +
        'TEST_DATABASE_URL explicitly to a disposable database.',
    );
  }
}

export default async function setup(): Promise<void> {
  const config = loadConfig();
  assertDisposableDatabase(config.DATABASE_URL);
  await runMigrations(config.DATABASE_URL);
}
