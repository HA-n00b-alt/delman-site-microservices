import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import logger from '../utils/logger';

export const rateLimitMiddleware = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded');
    res.status(429).json({
      error: 'Too many requests, please try again later.',
    });
  },
});

// Stricter rate limit for media processing endpoints
export const mediaRateLimitMiddleware = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.MEDIA_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, 'Media processing rate limit exceeded');
    res.status(429).json({
      error: 'Too many media processing requests, please try again later.',
    });
  },
});
