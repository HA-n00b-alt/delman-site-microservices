import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';

const SERVICE_API_KEY = process.env.SERVICE_API_KEY;

if (!SERVICE_API_KEY) {
  logger.error('SERVICE_API_KEY environment variable is not set');
  process.exit(1);
}

export const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'];

  if (typeof apiKey !== 'string') {
    logger.warn({ path: req.path }, 'Missing or invalid API key');
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }

  const expected = Buffer.from(SERVICE_API_KEY, 'utf8');
  const received = Buffer.from(apiKey, 'utf8');

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    logger.warn({ path: req.path }, 'Invalid API key');
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }

  next();
};
