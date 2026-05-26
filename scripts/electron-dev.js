#!/usr/bin/env node

const { spawn } = require('node:child_process');

const DEV_URL =
  process.env.PICG_DEV_URL ?? 'http://localhost:3000/desktop/galleries';
const SERVER_TIMEOUT_MS = 30_000;

let nextProcess = null;
let shuttingDown = false;

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function parseDevUrl() {
  const parsed = new URL(DEV_URL);
  const port =
    parsed.port || (parsed.protocol === 'https:' ? '443' : '3000');
  return {
    hostname: parsed.hostname,
    port,
  };
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand(), args, {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${npmCommand()} ${args.join(' ')} exited with ${
              signal ?? `code ${code}`
            }`
          )
        );
      }
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.status > 0) return true;
    } catch {
      // Server is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function startNextDev() {
  const { hostname, port } = parseDevUrl();
  if (!isLocalHost(hostname)) {
    throw new Error(
      `PICG_DEV_URL points at ${hostname}; start that dev server manually.`
    );
  }

  const args = [
    'run',
    'dev',
    '--',
    '--hostname',
    hostname === '::1' ? 'localhost' : hostname,
    '--port',
    port,
  ];
  nextProcess = spawn(npmCommand(), args, {
    stdio: 'inherit',
    env: process.env,
  });
  nextProcess.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(
        `[electron-dev] Next dev server exited with ${signal ?? `code ${code}`}`
      );
      process.exitCode = code ?? 1;
    }
  });
}

function stopNextDev() {
  shuttingDown = true;
  if (!nextProcess || nextProcess.killed) return;
  nextProcess.kill('SIGTERM');
}

async function main() {
  const alreadyRunning = await waitForServer(DEV_URL, 1_000);
  if (!alreadyRunning) {
    console.log(`[electron-dev] starting Next dev server for ${DEV_URL}`);
    startNextDev();
    const ready = await waitForServer(DEV_URL, SERVER_TIMEOUT_MS);
    if (!ready) {
      throw new Error(`Next dev server did not respond at ${DEV_URL}`);
    }
  } else {
    console.log(`[electron-dev] using existing Next dev server at ${DEV_URL}`);
  }

  await runNpm(['run', 'fetch:git']);
  await runNpm(['run', 'electron:build']);
  await runNpm(['run', 'electron:start']);
}

process.on('SIGINT', () => {
  stopNextDev();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopNextDev();
  process.exit(143);
});
process.on('exit', stopNextDev);

main().catch((err) => {
  console.error(`[electron-dev] ${err instanceof Error ? err.message : err}`);
  stopNextDev();
  process.exit(1);
});
