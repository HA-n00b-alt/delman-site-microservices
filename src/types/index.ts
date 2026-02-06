import { z } from 'zod';

// Debug levels
export const DEBUG_LEVELS = ['debug', 'info', 'warn', 'error', 'crit'] as const;
export type DebugLevel = (typeof DEBUG_LEVELS)[number];

export type DebugStep = {
  name: string;
  durationMs: number;
};

export type DebugInfo = {
  level: DebugLevel;
  requestId: string;
  startedAt: string;
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  steps?: DebugStep[];
  warnings?: string[];
  error?: string;
};

// Image formats
export const SUPPORTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif'] as const;
export type OutputFormat = (typeof SUPPORTED_IMAGE_FORMATS)[number];

export const CONTENT_TYPE_MAP: Record<OutputFormat, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  tiff: 'image/tiff',
  gif: 'image/gif',
};

// Fit options
export const VALID_FIT_OPTIONS = ['cover', 'contain', 'fill', 'inside', 'outside'] as const;
export type FitOption = (typeof VALID_FIT_OPTIONS)[number];

// Audio formats
export const SUPPORTED_AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'webm'] as const;
export type AudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];

// Zod Schemas for validation
export const imageConvertQuerySchema = z.object({
  format: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(SUPPORTED_IMAGE_FORMATS))
    .optional()
    .default('jpg'),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
  fit: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(VALID_FIT_OPTIONS))
    .optional()
    .default('cover'),
  debug: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(DEBUG_LEVELS))
    .optional(),
});

export type ImageConvertQuery = z.infer<typeof imageConvertQuerySchema>;

export const audioPeaksQuerySchema = z.object({
  samples: z.coerce.number().int().min(1).max(10000).optional(),
  samplesPerMinute: z.coerce.number().int().min(1).max(10000).optional(),
  debug: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(DEBUG_LEVELS))
    .optional(),
});

export type AudioPeaksQuery = z.infer<typeof audioPeaksQuerySchema>;

// Health check types
export type HealthCheckResult = {
  status: 'ok' | 'degraded';
  checks: {
    audiowaveform: boolean;
    sharp: boolean;
  };
  uptime: number;
};
