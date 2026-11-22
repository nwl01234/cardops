import { randomInt, randomUUID } from 'node:crypto';

const SKU_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function requestId(): string {
  return randomUUID();
}

export function generateSku(): string {
  const pick = () => SKU_ALPHABET[randomInt(SKU_ALPHABET.length)];
  const block = () => Array.from({ length: 4 }, pick).join('');
  return `CRD-${block()}-${block()}`;
}
