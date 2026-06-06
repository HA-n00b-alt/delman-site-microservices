import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import logger from '../utils/logger';

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not found' });
};

export const globalErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  const debugRequested = typeof req.query?.debug === 'string';
  const includeDetails = env.NODE_ENV !== 'production' || debugRequested;

  // Handle multer errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File too large. Maximum size: 20MB (images), 50MB (audio).' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }

  // Handle all other errors
  const body: Record<string, unknown> = { error: 'Internal server error' };
  if (includeDetails) {
    body.details = err.message || 'Unknown error';
  }
  res.status(500).json(body);
};
