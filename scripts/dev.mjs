import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  loadRootEnv,
  killTree,
  npmRun,
  openBrowser,
  spawnNpm,
  waitForHttp,
} from './lib/runtime.mjs';
import { ensureLocalPostgres, parseDatabaseUrl } from './lib/local-db.mjs';
import { startNats, startRedis } from './lib/infra.mjs';
import { startObjectStore } from './lib/object-store.mjs';

loadRootEnv();

const DEV_SECRET = randomBytes(32).toString('base64url');
const DEV_DOCUMENTS_TOKEN = 'dev-only-documents-internal-token-change-me-please';
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://cardops:cardops@localhost:55432/cardops';
const apiPort = Number(process.env.PORT ?? 8787);
const webPort = Number(process.env.WEB_PORT ?? 5173);
const notificationsPort = Number(process.env.NOTIFICATIONS_PORT ?? 8790);
const scanPort = Number(process.env.SCAN_PORT ?? 8791);
const documentsPort = Number(process.env.DOCUMENTS_PORT ?? 8792);
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const natsUrl = process.env.NATS_URL ?? 'nats://127.0.0.1:4222';

function localPort(value, fallback) {
  try {
    return Number(new URL(value).port || fallback);
  } catch {
    return fallback;
  }
}

const redisPort = localPort(redisUrl, 6379);
const natsPort = localPort(natsUrl, 4222);
const natsMonitorPort = natsPort === 4222 ? 8222 : natsPort + 4000;
const webHost = '127.0.0.1';

const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: databaseUrl,
  HOST: process.env.HOST ?? '127.0.0.1',
  PORT: String(apiPort),
  WEB_PORT: String(webPort),
  NOTIFICATIONS_PORT: String(notificationsPort),
  SCAN_PORT: String(scanPort),
  DOCUMENTS_PORT: String(documentsPort),
  DOCUMENTS_URL: process.env.DOCUMENTS_URL ?? `http://${webHost}:${documentsPort}`,
  DOCUMENTS_INTERNAL_TOKEN: process.env.DOCUMENTS_INTERNAL_TOKEN ?? DEV_DOCUMENTS_TOKEN,
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? '127.0.0.1',
  S3_PORT: process.env.S3_PORT ?? '9000',
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? 'S3RVER',
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? 'S3RVER',
  S3_BUCKET: process.env.S3_BUCKET ?? 'cardops-documents',
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? `http://${webHost}:${webPort}`,
  JWT_SECRET: process.env.JWT_SECRET ?? DEV_SECRET,
  JWT_TTL_MINUTES: process.env.JWT_TTL_MINUTES ?? '15',
  REFRESH_TTL_DAYS: process.env.REFRESH_TTL_DAYS ?? '30',
  REDIS_URL: redisUrl,
  NATS_URL: natsUrl,
  ALLOW_INSECURE_COOKIE: 'true',
  TRUST_PROXY: process.env.TRUST_PROXY ?? 'true',
  SEED_DEMO: process.env.SEED_DEMO ?? 'true',
  TESSDATA_PATH: path.join(ROOT, '.data', 'tessdata'),
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  APP_VERSION: process.env.APP_VERSION ?? '0.1.0',
};

if (env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}

console.log('\nCardOps — локальный сервисный runner');
console.log(`  repo: ${ROOT}`);
console.log(`  db:   ${databaseUrl}`);
console.log(`  redis:${redisUrl}`);
console.log(`  nats: ${natsUrl}`);

let db;
let redis;
let nats;
let s3;
try {
  redis = await startRedis({ port: redisPort });
  nats = await startNats({ port: natsPort, monitorPort: natsMonitorPort });
  s3 = await startObjectStore({ port: Number(env.S3_PORT) });
  db = await ensureLocalPostgres({
    databaseUrl,
    dataDir: path.join(ROOT, '.data', 'postgres'),
    onLog: process.env.PG_VERBOSE === '1' ? (line) => console.log(`[postgres] ${line}`) : undefined,
  });
  console.log(
    `  infra: redis=${redis.reused ? 'reused' : 'started'}, ` +
      `nats=${nats.reused ? 'reused' : 'started'}, ` +
      `s3=${s3.reused ? 'reused' : 'started'}, ` +
      `pg=${db.reused ? 'reused' : 'started'}\n`,
  );
} catch (error) {
  console.error('Failed to start local infrastructure:', error.message);
  process.exit(1);
}

let api;
let web;
let notifications;
let scan;
let documents;
let worker;
let watchdog;
let shuttingDown = false;
const stateFile = path.join(ROOT, '.data', 'demo-pids.json');

function startWatchdog() {
  if (process.env.NO_WATCHDOG === '1') return null;
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'scripts', 'watchdog.mjs'), String(process.pid), ROOT],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  child.unref();
  return child;
}

function writeState() {
  try {
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          launcher: process.pid,
          api: api?.pid ?? null,
          web: web?.pid ?? null,
          notifications: notifications?.pid ?? null,
          scan: scan?.pid ?? null,
          documents: documents?.pid ?? null,
          worker: worker?.pid ?? null,
          redis: redis?.process?.pid ?? null,
          nats: nats?.process?.pid ?? null,
          watchdog: watchdog?.pid ?? null,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.warn('Could not write demo state file:', error.message);
  }
}

function removeState() {
  try {
    rmSync(stateFile, { force: true });
  } catch {
    // The stop script also cleans the file.
  }
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nStopping CardOps services...');
  if (watchdog) {
    try {
      watchdog.kill();
    } catch {
      // The watchdog may have already exited.
    }
  }
  for (const child of [worker, documents, scan, notifications, web, api]) {
    await killTree(child);
  }
  if (s3?.stop) await s3.stop().catch(() => undefined);
  if (redis?.stop) await redis.stop().catch(() => undefined);
  if (nats?.stop) await nats.stop().catch(() => undefined);
  if (db?.managed && db.stop) {
    try {
      await db.stop();
    } catch (error) {
      console.warn('PostgreSQL shutdown warning:', error.message);
    }
  }
  removeState();
  process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('SIGHUP', () => void shutdown(0));
process.on('SIGBREAK', () => void shutdown(0));
process.on('exit', removeState);

try {
  console.log('Applying migrations...');
  await npmRun(['run', 'db:migrate', '--workspace', '@cardops/api'], env);
  console.log('Seeding demo data...');
  await npmRun(['run', 'db:seed', '--workspace', '@cardops/api'], env);
} catch (error) {
  console.error(error.message);
  await shutdown(1);
}

api = spawnNpm(['run', 'dev', '--workspace', '@cardops/api'], env);
notifications = spawnNpm(['run', 'dev', '--workspace', '@cardops/notifications'], {
  ...env,
  PORT: String(notificationsPort),
});
scan = spawnNpm(['run', 'dev', '--workspace', '@cardops/scan'], {
  ...env,
  PORT: String(scanPort),
});
documents = spawnNpm(['run', 'dev', '--workspace', '@cardops/documents'], {
  ...env,
  PORT: String(documentsPort),
  PDF_FONT_PATH: path.join(ROOT, 'services', 'documents', 'assets', 'NotoSans-Regular.ttf'),
});
worker = spawnNpm(['run', 'dev', '--workspace', '@cardops/outbox-worker'], env);
web = spawnNpm(['run', 'dev', '--workspace', '@cardops/web'], {
  ...env,
  CARDOPS_API_TARGET: `http://127.0.0.1:${apiPort}`,
  CARDOPS_SCAN_TARGET: `http://127.0.0.1:${scanPort}`,
  CARDOPS_WS_TARGET: `http://127.0.0.1:${notificationsPort}`,
});
watchdog = startWatchdog();
writeState();

for (const [name, child] of [
  ['api', api],
  ['notifications', notifications],
  ['scan', scan],
  ['documents', documents],
  ['worker', worker],
  ['web', web],
]) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[${name}] exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`);
    void shutdown(code === 0 ? 0 : 1);
  });
  child.on('error', (error) => {
    console.error(`[${name}] failed to spawn:`, error.message);
    void shutdown(1);
  });
}

const [apiReady, notificationsReady, scanReady, documentsReady, webReady] = await Promise.all([
  waitForHttp(`http://127.0.0.1:${apiPort}/api/health`),
  waitForHttp(`http://127.0.0.1:${notificationsPort}/health`),
  waitForHttp(`http://127.0.0.1:${scanPort}/health`),
  waitForHttp(`http://127.0.0.1:${documentsPort}/health`),
  waitForHttp(`http://${webHost}:${webPort}/`),
]);

if (!apiReady || !notificationsReady || !scanReady || !documentsReady || !webReady) {
  console.error(
    `Services did not become ready (api=${apiReady}, notifications=${notificationsReady}, ` +
      `scan=${scanReady}, documents=${documentsReady}, web=${webReady}).`,
  );
  await shutdown(1);
}

const parsed = parseDatabaseUrl(databaseUrl);
console.log(`
──────────────────────────────────────────────────────────────
 CardOps готов:  http://${webHost}:${webPort}
 API:            http://127.0.0.1:${apiPort}/api/health
 Notifications:  ws://127.0.0.1:${notificationsPort}/ws
 OCR scan:       http://127.0.0.1:${scanPort}/health
 Documents:      http://127.0.0.1:${documentsPort}/health
 Object storage: ${env.S3_ENDPOINT}:${env.S3_PORT} (${env.S3_BUCKET})
 PostgreSQL:     ${parsed.hostname}:${parsed.port}/${parsed.database}
 Redis:          ${redisUrl}
 NATS:           ${natsUrl}

 Демо-доступы:
   admin      / admin123
   manager    / manager123
   warehouse  / warehouse123

 Ctrl+C / stop-demo.bat — остановить весь контур.
──────────────────────────────────────────────────────────────
`);

if (process.env.NO_OPEN !== '1') {
  openBrowser(`http://${webHost}:${webPort}`);
}

await new Promise(() => {});
