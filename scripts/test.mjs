import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ROOT, loadRootEnv, killTree, npmRun, spawnNpm } from './lib/runtime.mjs';
import { ensureLocalPostgres, parseDatabaseUrl } from './lib/local-db.mjs';
import { startRedis } from './lib/infra.mjs';

loadRootEnv();

const DEV_SECRET = randomBytes(32).toString('base64url');
const testUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://cardops:cardops@localhost:55433/cardops_test';

const parsed = parseDatabaseUrl(testUrl);
if (!parsed.local && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
  console.error(
    'Refusing to run destructive tests against a non-local database. ' +
      'Set ALLOW_REMOTE_TEST_DB=1 if this is a dedicated test instance.',
  );
  process.exit(1);
}

let db;
if (process.env.SKIP_LOCAL_DB !== '1') {
  db = await ensureLocalPostgres({
    databaseUrl: testUrl,
    dataDir: path.join(ROOT, '.data', 'postgres-test'),
    onLog: process.env.PG_VERBOSE === '1' ? (line) => console.log(`[postgres] ${line}`) : undefined,
  });
}

const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380';
let redis;
if (process.env.SKIP_LOCAL_DB !== '1') {
  redis = await startRedis({
    port: 6380,
    dataDir: path.join(ROOT, '.data', 'redis-test'),
  });
}

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: testUrl,
  TEST_DATABASE_URL: testUrl,
  JWT_SECRET: process.env.JWT_SECRET ?? DEV_SECRET,
  JWT_TTL_MINUTES: '60',
  REFRESH_TTL_DAYS: '30',
  REDIS_URL: redisUrl,
  LOG_LEVEL: 'silent',
  LOGIN_RATE_LIMIT: '1000',
  COOKIE_SECURE: 'false',
  WEB_ORIGIN: 'http://localhost:5173',
};

let apiTests;
let webTests;
const serviceTests = [];
let exitCode = 0;

try {
  apiTests = spawnNpm(['run', 'test', '--workspace', '@cardops/api'], env);
  exitCode = await new Promise((resolve) => {
    apiTests.on('error', (error) => {
      console.error(error.message);
      resolve(1);
    });
    apiTests.on('exit', (code) => resolve(code ?? 1));
  });

  if (exitCode === 0) {
    webTests = spawnNpm(['run', 'test', '--workspace', '@cardops/web'], env);
    exitCode = await new Promise((resolve) => {
      webTests.on('error', (error) => {
        console.error(error.message);
        resolve(1);
      });
      webTests.on('exit', (code) => resolve(code ?? 1));
    });
  }

  for (const workspace of ['@cardops/notifications', '@cardops/scan']) {
    if (exitCode !== 0) break;
    const child = spawnNpm(['run', 'test', '--workspace', workspace], env);
    serviceTests.push(child);
    exitCode = await new Promise((resolve) => {
      child.on('error', (error) => {
        console.error(error.message);
        resolve(1);
      });
      child.on('exit', (code) => resolve(code ?? 1));
    });
  }
} finally {
  await killTree(apiTests);
  await killTree(webTests);
  for (const child of serviceTests) await killTree(child);
  if (redis?.stop) await redis.stop();
  if (db?.managed) await db.stop();
}

process.exit(exitCode);
