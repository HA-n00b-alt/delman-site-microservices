import { describe, it, expect } from 'vitest';
import { imageConvertQuerySchema, audioPeaksQuerySchema } from '../../src/types';

describe('imageConvertQuerySchema', () => {
  it('should use default values when empty', () => {
    const result = imageConvertQuerySchema.parse({});
    expect(result.format).toBe('jpg');
    expect(result.fit).toBe('cover');
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(result.debug).toBeUndefined();
  });

  it('should parse valid format', () => {
    const result = imageConvertQuerySchema.parse({ format: 'png' });
    expect(result.format).toBe('png');
  });

  it('should parse format case-insensitively', () => {
    const result = imageConvertQuerySchema.parse({ format: 'PNG' });
    expect(result.format).toBe('png');
  });

  it('should reject invalid format', () => {
    expect(() => imageConvertQuerySchema.parse({ format: 'bmp' })).toThrow();
  });

  it('should parse valid dimensions', () => {
    const result = imageConvertQuerySchema.parse({ width: '800', height: '600' });
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('should reject negative dimensions', () => {
    expect(() => imageConvertQuerySchema.parse({ width: '-100' })).toThrow();
  });

  it('should reject zero dimensions', () => {
    expect(() => imageConvertQuerySchema.parse({ width: '0' })).toThrow();
  });

  it('should parse valid fit options', () => {
    const options = ['cover', 'contain', 'fill', 'inside', 'outside'];
    for (const fit of options) {
      const result = imageConvertQuerySchema.parse({ fit });
      expect(result.fit).toBe(fit);
    }
  });

  it('should parse fit case-insensitively', () => {
    const result = imageConvertQuerySchema.parse({ fit: 'COVER' });
    expect(result.fit).toBe('cover');
  });

  it('should reject invalid fit', () => {
    expect(() => imageConvertQuerySchema.parse({ fit: 'stretch' })).toThrow();
  });

  it('should parse valid debug levels', () => {
    const levels = ['debug', 'info', 'warn', 'error', 'crit'];
    for (const debug of levels) {
      const result = imageConvertQuerySchema.parse({ debug });
      expect(result.debug).toBe(debug);
    }
  });
});

describe('audioPeaksQuerySchema', () => {
  it('should have optional samples (no default value)', () => {
    const result = audioPeaksQuerySchema.parse({});
    // samples is optional, calculated at runtime based on audio duration and samplesPerMinute
    expect(result.samples).toBeUndefined();
    expect(result.samplesPerMinute).toBeUndefined();
  });

  it('should parse valid samples', () => {
    const result = audioPeaksQuerySchema.parse({ samples: '500' });
    expect(result.samples).toBe(500);
  });

  it('should reject samples below minimum', () => {
    expect(() => audioPeaksQuerySchema.parse({ samples: '0' })).toThrow();
  });

  it('should reject samples above maximum', () => {
    expect(() => audioPeaksQuerySchema.parse({ samples: '10001' })).toThrow();
  });

  it('should accept samples at boundaries', () => {
    expect(audioPeaksQuerySchema.parse({ samples: '1' }).samples).toBe(1);
    expect(audioPeaksQuerySchema.parse({ samples: '10000' }).samples).toBe(10000);
  });

  it('should parse valid debug levels', () => {
    const result = audioPeaksQuerySchema.parse({ debug: 'info' });
    expect(result.debug).toBe('info');
  });
});
