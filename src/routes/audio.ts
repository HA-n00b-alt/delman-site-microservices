import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import * as path from 'path';
import {
  audioPeaksQuerySchema,
  SUPPORTED_AUDIO_FORMATS,
  DebugInfo,
} from '../types';
import {
  detectAudioFormat,
  extractPeaksWithAudiowaveform,
  createTempAudioFile,
  cleanupTempFile,
  getAudioDurationSeconds,
  validateAudioExtension,
} from '../utils/audio';
import { createDebugInfo, recordStep } from '../utils/debug';
import logger from '../utils/logger';
import { mediaRateLimitMiddleware } from '../middleware/rateLimit';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

/**
 * @openapi
 * /v1/audio/peaks:
 *   post:
 *     summary: Extract audio waveform peaks
 *     description: Upload an audio file to extract waveform peaks for visualization
 *     tags:
 *       - Audio
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - audio
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *                 description: The audio file to process
 *     parameters:
 *       - name: samples
 *         in: query
 *         description: Number of peaks to return (1-10000). Overrides samplesPerMinute.
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10000
 *       - name: samplesPerMinute
 *         in: query
 *         description: Peaks per minute if samples is not provided
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10000
 *           default: 120
 *       - name: debug
 *         in: query
 *         description: Debug level for response headers
 *         schema:
 *           type: string
 *           enum: [debug, info, warn, error, crit]
 *     responses:
 *       200:
 *         description: Audio peaks extracted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 peaks:
 *                   type: array
 *                   items:
 *                     type: number
 *                   description: Array of peak values (0-1)
 *                 samples:
 *                   type: integer
 *                   description: Number of samples returned
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  '/audio/peaks',
  mediaRateLimitMiddleware,
  upload.single('audio'),
  async (req: Request, res: Response): Promise<void> => {
    let tempInputPath: string | null = null;
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let debugInfo: DebugInfo | undefined;

    try {
      // Validate query parameters with Zod
      const queryResult = audioPeaksQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        const errors = queryResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
        res.status(400).json({ error: 'Invalid parameters', details: errors });
        return;
      }

      const { samples: samplesParam, samplesPerMinute: samplesPerMinuteParam, debug } = queryResult.data;

      if (debug) {
        debugInfo = createDebugInfo(debug, requestId);
      }

      if (!req.file) {
        logger.warn({ requestId }, 'No audio file provided');
        res.status(400).json({ error: 'No audio file provided', debug: debugInfo });
        return;
      }

      // Validate file extension
      const extStart = Date.now();
      const ext = path.extname(req.file.originalname).toLowerCase().slice(1);
      if (ext && !validateAudioExtension(ext)) {
        res.status(400).json({
          error: `Unsupported audio format: ${ext}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
          debug: debugInfo,
        });
        return;
      }
      recordStep(debugInfo, 'validate_extension', extStart);

      // Validate audio file signature (magic bytes)
      const detectStart = Date.now();
      const detectedFormat = detectAudioFormat(req.file.buffer);
      if (detectedFormat && !validateAudioExtension(detectedFormat)) {
        res.status(400).json({
          error: `Unsupported audio format: ${detectedFormat}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
          debug: debugInfo,
        });
        return;
      }
      recordStep(debugInfo, 'detect_format', detectStart);

      logger.info(
        {
          requestId,
          fileName: req.file.originalname,
          size: req.file.size,
          samples: samplesParam,
          samplesPerMinute: samplesPerMinuteParam,
          detectedFormat,
        },
        'Processing audio peaks extraction'
      );

      // Write buffer to temp file
      const writeStart = Date.now();
      tempInputPath = await createTempAudioFile(req.file.buffer, ext);
      recordStep(debugInfo, 'write_temp_file', writeStart);

      let samples = samplesParam;
      let durationSeconds: number | null = null;
      let samplesPerMinute = samplesPerMinuteParam ?? 120;

      if (!samples) {
        const durationStart = Date.now();
        durationSeconds = await getAudioDurationSeconds(tempInputPath);
        recordStep(debugInfo, 'get_duration', durationStart);
        const durationMinutes = durationSeconds / 60;
        samples = Math.round(durationMinutes * samplesPerMinute);
      }

      if (!samples || samples <= 0) {
        res.status(400).json({ error: 'Invalid samples configuration', debug: debugInfo });
        return;
      }

      if (samples > 10000) {
        res.status(400).json({
          error: 'Invalid samples configuration. Must be between 1 and 10000.',
          debug: debugInfo,
        });
        return;
      }

      // Extract peaks
      const extractStart = Date.now();
      const peaks = await extractPeaksWithAudiowaveform(tempInputPath, samples);
      recordStep(debugInfo, 'extract_peaks', extractStart);

      if (debugInfo) {
        debugInfo.input = {
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          extension: ext || null,
          detectedFormat: detectedFormat || null,
        };
        debugInfo.output = {
          samplesRequested: samples,
          samplesReturned: peaks.length,
          samplesPerMinute,
          durationSeconds,
        };
        debugInfo.durationMs = Date.now() - startedAt;
      }

      logger.info(
        { requestId, peaksCount: peaks.length, durationMs: Date.now() - startedAt },
        'Audio peaks extraction complete'
      );

      res.set('X-Request-Id', requestId);
      if (debugInfo) {
        res.set('X-Debug-Level', debugInfo.level);
        res.set('X-Processing-Time-Ms', debugInfo.durationMs?.toString() || '0');
      }

      res.json({ peaks, samples: peaks.length, debug: debugInfo });
    } catch (error) {
      if (debugInfo) {
        debugInfo.error = error instanceof Error ? error.message : 'Unknown error';
        debugInfo.durationMs = Date.now() - startedAt;
      }
      logger.error({ requestId, err: error }, 'Audio peaks extraction error');
      res.status(500).json({
        error: 'Failed to extract audio peaks',
        details: error instanceof Error ? error.message : 'Unknown error',
        debug: debugInfo,
      });
    } finally {
      await cleanupTempFile(tempInputPath);
    }
  }
);

export default router;
