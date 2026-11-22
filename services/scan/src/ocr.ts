import { createWorker, type Worker } from 'tesseract.js';
import path from 'node:path';
import type { ScanConfig } from './env';
import type { AppLogger } from './logger';

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

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

const SKU_PATTERN = /CRD-[A-Z0-9]+(?:-[A-Z0-9]+)+/i;

export function extractSku(text: string): string | null {
  const match = text.toUpperCase().match(SKU_PATTERN);
  return match?.[0] ?? null;
}

export async function recognize(
  image: Buffer,
  config: ScanConfig,
  logger: AppLogger,
): Promise<OcrResult> {
  const startedAt = Date.now();
  const task = queue.then(async () => {
    const worker = await getWorker(config, logger);
    const result = await worker.recognize(image);
    const text = result.data.text.trim();
    return {
      text,
      code: extractSku(text),
      confidence: Math.round(result.data.confidence),
      durationMs: Date.now() - startedAt,
    } satisfies OcrResult;
  });

  // Serialize Tesseract jobs: one worker processes one image at a time.
  queue = task.catch(() => undefined);
  return task;
}

export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } finally {
    workerPromise = null;
  }
}
