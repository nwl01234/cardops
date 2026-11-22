import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { ROOT } from './runtime.mjs';

const NATS_VERSION = '2.15.3';
const REDIS_URL =
  'https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip';
const NATS_URL = `https://github.com/nats-io/nats-server/releases/download/v${NATS_VERSION}/nats-server-v${NATS_VERSION}-windows-amd64.zip`;

export const REDIS_EXE = path.join(ROOT, '.data', 'bin', 'redis', 'redis-server.exe');
export const NATS_EXE = path.join(
  ROOT,
  '.data',
  'bin',
  'nats',
  `nats-server-v${NATS_VERSION}-windows-amd64`,
  'nats-server.exe',
);

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForPort(port, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Port ${port} did not open`);
}

async function expand(zip, destination) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Expand-Archive failed (${code})`)),
    );
    child.on('error', reject);
  });
}

async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

export async function ensureInfraBinaries() {
  if (process.platform !== 'win32') {
    throw new Error('Local infra binaries are prepared for Windows in this demo.');
  }

  if (!existsSync(REDIS_EXE)) {
    const zip = path.join(ROOT, '.data', 'downloads', 'redis.zip');
    if (!existsSync(zip)) await download(REDIS_URL, zip);
    await expand(zip, path.join(ROOT, '.data', 'bin', 'redis'));
  }

  if (!existsSync(NATS_EXE)) {
    const zip = path.join(ROOT, '.data', 'downloads', 'nats.zip');
    if (!existsSync(zip)) await download(NATS_URL, zip);
    await expand(zip, path.join(ROOT, '.data', 'bin', 'nats'));
  }
}

function redisConfig({ port, dataDir }) {
  return [
    'bind 127.0.0.1',
    `port ${port}`,
    'protected-mode yes',
    'appendonly no',
    'save ""',
    `dir ${path.resolve(dataDir).replace(/\\/g, '/')}`,
    'databases 16',
    '',
  ].join('\n');
}

export async function startRedis({
  port = 6379,
  dataDir = path.join(ROOT, '.data', 'redis'),
} = {}) {
  await ensureInfraBinaries();
  if (await portOpen(port)) return { reused: true, stop: async () => undefined };

  await mkdir(dataDir, { recursive: true });
  const configPath = path.join(dataDir, 'redis.conf');
  await writeFile(configPath, redisConfig({ port, dataDir }));

  const child = spawn(REDIS_EXE, [configPath], {
    stdio: 'ignore',
    windowsHide: true,
    cwd: ROOT,
  });
  child.unref();
  await waitForPort(port);

  return {
    reused: false,
    process: child,
    stop: async () => {
      if (child.exitCode !== null) return;
      await new Promise((resolve) => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.on('exit', resolve);
        killer.on('error', resolve);
      });
    },
  };
}

export async function startNats({
  port = 4222,
  monitorPort = 8222,
  dataDir = path.join(ROOT, '.data', 'nats'),
} = {}) {
  await ensureInfraBinaries();
  if (await portOpen(port)) return { reused: true, stop: async () => undefined };

  await mkdir(dataDir, { recursive: true });
  const child = spawn(
    NATS_EXE,
    ['-a', '127.0.0.1', '-js', '-p', String(port), '-m', String(monitorPort), '-sd', dataDir],
    {
      stdio: 'ignore',
      windowsHide: true,
      cwd: ROOT,
    },
  );
  child.unref();
  await waitForPort(port);

  return {
    reused: false,
    process: child,
    stop: async () => {
      if (child.exitCode !== null) return;
      await new Promise((resolve) => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.on('exit', resolve);
        killer.on('error', resolve);
      });
    },
  };
}
