import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { loadRootEnv } from './lib/runtime.mjs';

loadRootEnv();

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run db:restore -- .data/backups/cardops-....json');
  process.exit(1);
}

const snapshot = JSON.parse(readFileSync(file, 'utf8'));
if (snapshot.format !== 'cardops-json-v1' || !snapshot.tables) {
  console.error('Unsupported backup format');
  process.exit(1);
}

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://cardops:cardops@localhost:55432/cardops';
const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

const order = ['warehouses', 'users', 'cards', 'operations', 'idempotency_keys', 'outbox_events'];
const jsonColumns = new Set(['details', 'payload', 'response_body']);

try {
  await sql.begin(async (tx) => {
    await tx.unsafe(`
      truncate table operations, outbox_events, idempotency_keys, refresh_tokens, cards, users, warehouses
      restart identity cascade
    `);

    for (const table of order) {
      const rows = snapshot.tables[table] ?? [];
      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map((column) => {
          const value = row[column];
          return jsonColumns.has(column) && value !== null ? JSON.stringify(value) : value;
        });
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
        const quoted = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(',');
        const overriding =
          table === 'operations' || table === 'outbox_events' ? ' overriding system value' : '';
        await tx.unsafe(
          `insert into ${table} (${quoted})${overriding} values (${placeholders})`,
          values,
        );
      }

      if (table === 'operations' || table === 'outbox_events') {
        await tx.unsafe(
          `select setval(pg_get_serial_sequence('${table}', 'id'), coalesce((select max(id) from ${table}), 1), true)`,
        );
      }
    }
  });
  console.log(`Backup restored: ${file}`);
} finally {
  await sql.end({ timeout: 3 });
}
