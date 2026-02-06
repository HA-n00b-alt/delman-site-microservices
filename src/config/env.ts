import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Security
  SERVICE_API_KEY: z.string().min(1).optional(),
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  MEDIA_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(30),

  // Audio processing
  AUDIOWAVEFORM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  AUDIO_DURATION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  AUDIOWAVEFORM_PIXELS_PER_SECOND: z.coerce.number().int().positive().default(10),
  AUDIOWAVEFORM_BITS: z.coerce.number().int().min(8).max(16).default(8),

  // Odesli (Songlink) – music link conversion (no API key; see https://linktree.notion.site/API-d0ebe08a5e304a55928405eb682f6741)
  ODESLI_API_BASE_URL: z.string().url().default('https://api.song.link'),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    console.error('Environment validation failed:\n' + errors.join('\n'));
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
