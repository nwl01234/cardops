import path from 'node:path';
import { ROOT, loadRootEnv } from './lib/runtime.mjs';
import { ensureLocalPostgres } from './lib/local-db.mjs';

loadRootEnv();

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://cardops:cardops@localhost:55432/cardops';

const db = await ensureLocalPostgres({
  databaseUrl,
  dataDir: path.join(ROOT, '.data', 'postgres'),
  onLog: process.env.PG_VERBOSE === '1' ? (line) => console.log(`[postgres] ${line}`) : undefined,
});

console.log(`PostgreSQL is available at ${databaseUrl}`);
console.log(
  db.reused ? 'Using an already running instance.' : 'Managed embedded instance started.',
);

if (!db.managed) {
  process.exit(0);
}

process.on('SIGINT', async () => {
  await db.stop();
  process.exit(0);
});

await new Promise(() => {});
