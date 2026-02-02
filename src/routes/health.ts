import { Router, Request, Response } from 'express';
import sharp from 'sharp';
import { isAudiowaveformAvailable } from '../utils/audio';
import { HealthCheckResult } from '../types';
import logger from '../utils/logger';

const router = Router();
const startTime = Date.now();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the health status of the service and its dependencies
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [ok, degraded]
 *                 checks:
 *                   type: object
 *                   properties:
 *                     audiowaveform:
 *                       type: boolean
 *                     sharp:
 *                       type: boolean
 *                 uptime:
 *                   type: number
 *                   description: Uptime in seconds
 *       503:
 *         description: Service is degraded
 */
router.get('/health', async (_req: Request, res: Response) => {
  const checks = {
    audiowaveform: false,
    sharp: false,
  };

  // Check audiowaveform binary
  try {
    checks.audiowaveform = isAudiowaveformAvailable();
  } catch (err) {
    logger.warn({ err }, 'audiowaveform check failed');
  }

  // Check sharp library
  try {
    await sharp(Buffer.alloc(1, 0))
      .metadata()
      .then(() => {
        checks.sharp = true;
      })
      .catch(() => {
        checks.sharp = false;
      });
  } catch (err) {
    logger.warn({ err }, 'sharp check failed');
  }

  const healthy = Object.values(checks).every(Boolean);
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  const result: HealthCheckResult = {
    status: healthy ? 'ok' : 'degraded',
    checks,
    uptime,
  };

  res.status(healthy ? 200 : 503).json(result);
});

export default router;
