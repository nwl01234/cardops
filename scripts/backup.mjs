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
  const snapshot = await sql.begin(async (tx) => {
    // A consistent snapshot across all business tables; without this a
    // concurrent transition can produce a backup where a card exists but its
    // audit/outbox rows do not.
    await tx.unsafe('set transaction isolation level repeatable read');
    const data = {
      format: 'cardops-json-v1',
      createdAt: new Date().toISOString(),
      tables: {},
    };
    for (const table of tables) {
      data.tables[table] = await tx.unsafe(`select * from ${table} order by 1`);
    }
    return data;
  });

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
