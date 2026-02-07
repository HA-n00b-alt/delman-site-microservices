import express from 'express';
import swaggerUi from 'swagger-ui-express';
import sharp from 'sharp';

import { env } from './config/env';
import logger from './utils/logger';
import { swaggerSpec } from './config/swagger';
import { corsMiddleware } from './middleware/cors';
import { apiKeyMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { notFoundHandler, globalErrorHandler } from './middleware/errorHandler';

import healthRouter from './routes/health';
import imageRouter from './routes/image';
import audioRouter from './routes/audio';
import odesliRouter from './routes/odesli';

// Disable libvips cache to prevent memory accumulation when processing many images
// sequentially. The cache (default 50MB) grows across requests on long-running
// instances and contributes to OOM after 8–9 photos with 1Gi limit.
sharp.cache(false);

const app = express();

if (!env.CORS_ALLOWED_ORIGINS) {
  if (env.NODE_ENV === 'production') {
    logger.error('CORS_ALLOWED_ORIGINS is not set. Refusing to start in production.');
    process.exit(1);
  } else {
    logger.warn('CORS_ALLOWED_ORIGINS is not set. Browser requests will be blocked.');
  }
}

// Global middleware
app.use(corsMiddleware);
app.use(rateLimitMiddleware);

// API Documentation (no auth required)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (_req, res) => {
  res.json(swaggerSpec);
});

// Health check (no auth required)
app.use(healthRouter);

// Apply API key middleware to versioned routes
app.use('/v1', apiKeyMiddleware);

// API v1 routes
app.use('/v1', imageRouter);
app.use('/v1', audioRouter);
app.use('/v1', odesliRouter);

// Legacy routes (for backward compatibility, will be deprecated)
app.use(apiKeyMiddleware);
app.use(imageRouter);
app.use(audioRouter);
app.use(odesliRouter);

// Error handlers
app.use(notFoundHandler);
app.use(globalErrorHandler);

// Start server only when run directly (not when imported by tests)
if (env.NODE_ENV !== 'test') {
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'Media processing service started');
  });

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Force shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export { app };
