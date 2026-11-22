import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const parentPid = Number(process.argv[2]);
const root = process.argv[3];

if (!Number.isInteger(parentPid) || parentPid <= 0 || !root) {
  process.exit(1);
}

const stateFile = path.join(root, '.data', 'demo-pids.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parentAlive() {
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}

function kill(pid) {
  if (!pid) return Promise.resolve();
  return new Promise((resolve) => {
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('exit', resolve);
    child.on('error', resolve);
  });
}

async function cleanup() {
  let state = null;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    // The runner may have already removed the state file.
  }

  if (process.platform === 'win32') {
    // stop-demo.ps1 also stops the embedded PostgreSQL postmaster. It is
    // spawned detached so the cleanup can finish even if this watchdog dies.
    const cleaner = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'scripts', 'stop-demo.ps1'),
      ],
      { stdio: 'ignore', windowsHide: true, detached: true },
    );
    cleaner.unref();
    return;
  }

  for (const pid of [state?.api, state?.web, state?.launcher]) {
    await kill(pid);
  }
}

// A short grace period avoids racing a startup that is still in progress.
await sleep(2_000);

while (parentAlive()) {
  await sleep(1_000);
}

await cleanup();
process.exit(0);
