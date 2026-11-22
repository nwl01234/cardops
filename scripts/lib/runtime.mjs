import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export function loadRootEnv() {
  const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
  const examplePath = fileURLToPath(new URL('../../.env.example', import.meta.url));

  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    console.log('[env] .env created from .env.example (demo defaults)');
  }

  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

export function spawnProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
    windowsHide: true,
    shell: options.shell ?? false,
  });
}

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((value) => typeof value === 'string' && value.length > 0);
  return candidates.find((candidate) => existsSync(candidate));
}

export function spawnNpm(args, env) {
  const cli = npmCliPath();
  if (cli) {
    // Running npm-cli.js through node avoids .cmd shims and the Node 24
    // shell-argument deprecation on Windows.
    return spawn(process.execPath, [cli, ...args], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
  }
  return spawnProcess(NPM, args, {
    env,
    shell: process.platform === 'win32',
  });
}

export function npmRun(args, env) {
  const child = spawnNpm(args, env);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} exited with code ${code}`));
    });
  });
}

export async function waitForHttp(url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export function openBrowser(url) {
  const command =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/d', '/c', 'start', '', url] : [url];
  spawn(command, args, { stdio: 'ignore', windowsHide: true, detached: true }).unref();
}

export async function killTree(child) {
  if (!child || !child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('exit', resolve);
      killer.on('error', resolve);
    });
  } else {
    child.kill('SIGTERM');
  }
}
