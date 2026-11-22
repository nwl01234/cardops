import { createWorker, type Worker } from 'tesseract.js';
import path from 'node:path';
import type { ScanConfig } from './env';
import type { AppLogger } from './logger';

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let queued = 0;

const MAX_QUEUE = 4;
const OCR_TIMEOUT_MS = 20_000;

export class OcrBusyError extends Error {
  constructor() {
    super('OCR queue is full');
    this.name = 'OcrBusyError';
  }
}

export class OcrTimeoutError extends Error {
  constructor() {
    super('OCR timed out');
    this.name = 'OcrTimeoutError';
  }
}

async function getWorker(config: ScanConfig, logger: AppLogger): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      cachePath: path.resolve(config.TESSDATA_PATH),
      langPath: path.resolve(config.TESSDATA_PATH),
      logger: (message) => {
        if (message.status === 'recognizing text') {
          logger.debug({ progress: message.progress }, 'OCR progress');
        }
      },
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export interface OcrResult {
  text: string;
  code: string | null;
  confidence: number;
  durationMs: number;
}

const SKU_PATTERN = /CRD-[A-Z0-9]+(?:-[A-Z0-9]+)*/i;

export function extractSku(text: string): string | null {
  const match = text.toUpperCase().match(SKU_PATTERN);
  return match?.[0] ?? null;
}

export async function recognize(
  image: Buffer,
  config: ScanConfig,
  logger: AppLogger,
): Promise<OcrResult> {
  if (queued >= MAX_QUEUE) throw new OcrBusyError();
  queued += 1;

  const startedAt = Date.now();
  const task = queue
    .then(async () => {
      const worker = await getWorker(config, logger);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // A hung Tesseract worker must not block the queue forever. Detach
          // it synchronously and let the next task create a fresh worker.
          void disposeOcr().catch(() => undefined);
          reject(new OcrTimeoutError());
        }, OCR_TIMEOUT_MS);
      });

      try {
        const result = await Promise.race([worker.recognize(image), timeout]);
        const text = result.data.text.trim();
        return {
          text,
          code: extractSku(text),
          confidence: Math.round(result.data.confidence),
          durationMs: Date.now() - startedAt,
        } satisfies OcrResult;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })
    .finally(() => {
      queued -= 1;
    });

  // Serialize Tesseract jobs: one worker processes one image at a time.
  queue = task.catch(() => undefined);
  return task;
}

export async function disposeOcr(): Promise<void> {
  const pending = workerPromise;
  // Clear the slot before awaiting termination so a queued task can start a
  // fresh worker immediately after a timeout.
  workerPromise = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // A crashed worker is already unusable; the next task creates a new one.
  }
}
