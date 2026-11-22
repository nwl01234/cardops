import { describe, expect, it } from 'vitest';
import { extractSku } from '../src/ocr';

describe('OCR SKU extraction', () => {
  it('extracts a CRD SKU from noisy text', () => {
    expect(extractSku('Карта\nCRD-DEMO-01\nМосква')).toBe('CRD-DEMO-01');
  });

  it('normalizes lowercase and ignores unrelated text', () => {
    expect(extractSku('code: crd-abcd-1234')).toBe('CRD-ABCD-1234');
    expect(extractSku('no card here')).toBeNull();
  });
});
