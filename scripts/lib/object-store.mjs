import net from 'node:net';
import path from 'node:path';
import S3rver from 's3rver';
import { ROOT } from './runtime.mjs';

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

/**
 * Local S3-compatible endpoint. The documents service uses the MinIO client
 * with the same S3 API in production; this keeps the no-Docker demo runnable
 * without a 100 MB native binary.
 */
export async function startObjectStore({ port = 9000 } = {}) {
  if (await portOpen(port)) return { reused: true, stop: async () => undefined };

  const directory = path.join(ROOT, '.data', 's3');
  const server = new S3rver({
    port,
    address: '127.0.0.1',
    silent: true,
    directory,
    configureBuckets: [{ name: 'cardops-documents' }],
  });
  await server.run();
  return {
    reused: false,
    port,
    stop: async () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
