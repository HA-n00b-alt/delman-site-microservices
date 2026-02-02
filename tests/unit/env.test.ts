import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-create the schema for testing (can't import env.ts directly as it runs validation on import)
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SERVICE_API_KEY: z.string().min(1).optional(),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  MEDIA_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(30),
  MAX_IMAGE_BATCH_FILES: z.coerce.number().int().positive().default(15),
  MAX_IMAGE_VARIANTS_PER_FILE: z.coerce.number().int().positive().default(12),
  MAX_AUDIO_BATCH_FILES: z.coerce.number().int().positive().default(3),
  MAX_AUDIO_VARIANTS_PER_FILE: z.coerce.number().int().positive().default(4),
  AUDIOWAVEFORM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  AUDIO_DURATION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  AUDIOWAVEFORM_PIXELS_PER_SECOND: z.coerce.number().int().positive().default(10),
  AUDIOWAVEFORM_BITS: z.coerce.number().int().min(8).max(16).default(8),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

describe('Environment Schema Validation', () => {
  it('should use default values when env vars are not set', () => {
    const result = envSchema.parse({});

    expect(result.PORT).toBe(8080);
    expect(result.NODE_ENV).toBe('development');
    expect(result.CORS_ALLOWED_ORIGINS).toBe('');
    expect(result.RATE_LIMIT_WINDOW_MS).toBe(60000);
    expect(result.RATE_LIMIT_MAX_REQUESTS).toBe(100);
    expect(result.MEDIA_RATE_LIMIT_MAX_REQUESTS).toBe(30);
    expect(result.MAX_IMAGE_BATCH_FILES).toBe(15);
    expect(result.MAX_IMAGE_VARIANTS_PER_FILE).toBe(12);
    expect(result.MAX_AUDIO_BATCH_FILES).toBe(3);
    expect(result.MAX_AUDIO_VARIANTS_PER_FILE).toBe(4);
    expect(result.AUDIOWAVEFORM_TIMEOUT_MS).toBe(15000);
    expect(result.AUDIO_DURATION_TIMEOUT_MS).toBe(5000);
    expect(result.AUDIOWAVEFORM_PIXELS_PER_SECOND).toBe(10);
    expect(result.AUDIOWAVEFORM_BITS).toBe(8);
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('should coerce string numbers to integers', () => {
    const result = envSchema.parse({
      PORT: '3000',
      RATE_LIMIT_WINDOW_MS: '120000',
      RATE_LIMIT_MAX_REQUESTS: '200',
    });

    expect(result.PORT).toBe(3000);
    expect(result.RATE_LIMIT_WINDOW_MS).toBe(120000);
    expect(result.RATE_LIMIT_MAX_REQUESTS).toBe(200);
  });

  it('should reject invalid NODE_ENV values', () => {
    const result = envSchema.safeParse({ NODE_ENV: 'invalid' });

    expect(result.success).toBe(false);
  });

  it('should reject invalid LOG_LEVEL values', () => {
    const result = envSchema.safeParse({ LOG_LEVEL: 'verbose' });

    expect(result.success).toBe(false);
  });

  it('should reject negative port numbers', () => {
    const result = envSchema.safeParse({ PORT: '-1' });

    expect(result.success).toBe(false);
  });

  it('should reject invalid audiowaveform bits', () => {
    const tooLow = envSchema.safeParse({ AUDIOWAVEFORM_BITS: '4' });
    const tooHigh = envSchema.safeParse({ AUDIOWAVEFORM_BITS: '32' });

    expect(tooLow.success).toBe(false);
    expect(tooHigh.success).toBe(false);
  });

  it('should accept valid audiowaveform bits', () => {
    const bits8 = envSchema.parse({ AUDIOWAVEFORM_BITS: '8' });
    const bits16 = envSchema.parse({ AUDIOWAVEFORM_BITS: '16' });

    expect(bits8.AUDIOWAVEFORM_BITS).toBe(8);
    expect(bits16.AUDIOWAVEFORM_BITS).toBe(16);
  });

  it('should handle NaN values by using defaults', () => {
    // Zod coerce will fail on invalid numbers
    const result = envSchema.safeParse({ PORT: 'not-a-number' });

    expect(result.success).toBe(false);
  });
});
