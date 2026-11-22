import { describe, expect, it } from 'vitest';
import { sniffImageType } from '../src/image';

function bytes(...values: number[]): Buffer {
  return Buffer.from([...values, ...Array(16).fill(0)]);
}

describe('image magic-byte validation', () => {
  it('accepts the formats Tesseract can decode', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('image/png');
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x42, 0x4d))).toBe('image/bmp');
    expect(sniffImageType(bytes(0x49, 0x49, 0x2a, 0x00))).toBe('image/tiff');
  });

  it('rejects renamed executables, archives and short bodies', () => {
    expect(sniffImageType(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(sniffImageType(Buffer.from('PK\x03\x04'))).toBeNull();
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});
