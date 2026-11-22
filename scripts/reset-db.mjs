import { loadRootEnv, npmRun, ROOT } from './lib/runtime.mjs';
import postgres from 'postgres';

loadRootEnv();

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://cardops:cardops@localhost:55432/cardops';

const host = new URL(databaseUrl).hostname;
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
if (!isLocal && process.env.ALLOW_REMOTE_DB_RESET !== '1') {
  console.error(
    'Refusing to truncate a remote database. Set ALLOW_REMOTE_DB_RESET=1 for a dedicated demo DB.',
  );
  process.exit(1);
}

const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
try {
  await client.unsafe(`
    truncate table operations, outbox_events, idempotency_keys, cards, users, warehouses
    restart identity cascade
  `);
  console.log('[reset] business tables truncated');
} finally {
  await client.end({ timeout: 3 });
}

await npmRun(['run', 'db:seed', '--workspace', '@cardops/api'], {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'development',
});
console.log('[reset] demo fixtures restored');
