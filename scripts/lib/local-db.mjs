import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';

function localHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function parseDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    hostname: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    local: localHost(url.hostname),
  };
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function ensureDatabaseWithClient(client, database) {
  const quoted = `"${database.replace(/"/g, '""')}"`;

  if (typeof client.unsafe === 'function') {
    // postgres.js (external instance path)
    const existing = await client.unsafe(`select 1 from pg_database where datname = $1`, [
      database,
    ]);
    if (existing.length === 0) await client.unsafe(`create database ${quoted}`);
    return;
  }

  // node-postgres (embedded-postgres path)
  const existing = await client.query('select 1 from pg_database where datname = $1', [database]);
  if (existing.rowCount === 0) await client.query(`create database ${quoted}`);
}

async function ensureExternalDatabase(parts, databaseUrl) {
  const adminUrl = `postgres://${encodeURIComponent(parts.user)}:${encodeURIComponent(parts.password)}@${parts.hostname}:${parts.port}/postgres`;
  const client = postgres(adminUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    await ensureDatabaseWithClient(client, parts.database);
  } catch (error) {
    throw new Error(
      `Port ${parts.port} is occupied, but "${databaseUrl}" is not reachable with the demo credentials. ` +
        `Change DATABASE_URL in .env or stop the process using that port.`,
      { cause: error },
    );
  } finally {
    await client.end({ timeout: 3 });
  }
}

/**
 * Starts a real PostgreSQL 17 cluster from the npm package when DATABASE_URL
 * points at localhost. On machines with Docker/compose this is not used; the
 * same code path then connects to the postgres service.
 */
export async function ensureLocalPostgres({ databaseUrl, dataDir, onLog = () => {} }) {
  const parts = parseDatabaseUrl(databaseUrl);
  if (!parts.local) {
    return { managed: false, reused: false, parts };
  }

  const host = parts.hostname === '::1' ? '127.0.0.1' : parts.hostname;

  if (await portOpen(host, parts.port)) {
    await ensureExternalDatabase(parts, databaseUrl);
    return { managed: false, reused: true, parts };
  }

  await mkdir(dataDir, { recursive: true });
  const initialized = existsSync(path.join(dataDir, 'PG_VERSION'));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: parts.port,
    user: parts.user,
    password: parts.password,
    persistent: true,
    onLog,
    onError: (message) => {
      const text = String(message);
      if (!text.includes('already exists')) console.error('[postgres]', text);
    },
  });

  if (!initialized) {
    await pg.initialise();
  }
  await pg.start();

  const client = pg.getPgClient('postgres');
  try {
    await client.connect();
    await ensureDatabaseWithClient(client, parts.database);
  } finally {
    await client.end();
  }

  return {
    managed: true,
    reused: false,
    parts,
    stop: async () => {
      await pg.stop();
    },
  };
}

export function waitForPostgres(parts, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = async () => {
      if (await portOpen(parts.hostname === '::1' ? '127.0.0.1' : parts.hostname, parts.port)) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`PostgreSQL did not start on port ${parts.port}`));
        return;
      }
      setTimeout(attempt, 250);
    };
    void attempt();
  });
}
