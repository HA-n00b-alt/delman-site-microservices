import cors from 'cors';
import { env } from '../config/env';
import logger from '../utils/logger';

const CORS_ALLOWED_ORIGINS = env.CORS_ALLOWED_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server requests)
    if (!origin) return callback(null, true);
    if (CORS_ALLOWED_ORIGINS.length === 0) return callback(null, false);
    if (CORS_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    logger.warn({ origin }, 'CORS origin not allowed');
    return callback(null, false);
  },
  exposedHeaders: ['X-Debug-Info', 'X-Debug-Level', 'X-Request-Id', 'X-Processing-Time-Ms'],
});
