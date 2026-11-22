import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { ROOT, loadRootEnv } from './lib/runtime.mjs';

loadRootEnv();

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://cardops:cardops@localhost:55432/cardops';
const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

const tables = ['warehouses', 'users', 'cards', 'operations', 'idempotency_keys', 'outbox_events'];

try {
  const snapshot = {
    format: 'cardops-json-v1',
    createdAt: new Date().toISOString(),
    tables: {},
  };

  for (const table of tables) {
    snapshot.tables[table] = await sql.unsafe(`select * from ${table} order by 1`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(ROOT, '.data', 'backups');
  mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, `cardops-${stamp}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  console.log(`Backup created: ${file}`);
  console.log(
    Object.entries(snapshot.tables)
      .map(([name, rows]) => `${name}=${rows.length}`)
      .join(' '),
  );
} finally {
  await sql.end({ timeout: 3 });
}
