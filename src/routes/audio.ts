import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import * as path from 'path';
import archiver from 'archiver';
import { env } from '../config/env';
import {
  audioPeaksQuerySchema,
  audioBatchManifestSchema,
  SUPPORTED_AUDIO_FORMATS,
  DebugInfo,
  AudioBatchDebugSummary,
  AudioFileDebug,
  AudioVariantDebug,
} from '../types';
import {
  detectAudioFormat,
  extractPeaksWithAudiowaveform,
  createTempAudioFile,
  cleanupTempFile,
  getAudioDurationSeconds,
  validateAudioExtension,
} from '../utils/audio';
import { createDebugInfo, parseDebugLevel, recordStep, encodeDebugInfo } from '../utils/debug';
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

/**
 * @openapi
 * /v1/audio/peaks/batch:
 *   post:
 *     summary: Batch audio peaks extraction
 *     description: Upload multiple audio files and get a ZIP with peak JSON files
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
 *               - manifest
 *             properties:
 *               audio:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Audio files (max 3)
 *               manifest:
 *                 type: string
 *                 description: JSON manifest describing variants
 *     parameters:
 *       - name: debug
 *         in: query
 *         description: Debug level for response headers
 *         schema:
 *           type: string
 *           enum: [debug, info, warn, error, crit]
 *     responses:
 *       200:
 *         description: ZIP archive with peak files
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  '/audio/peaks/batch',
  mediaRateLimitMiddleware,
  upload.array('audio', env.MAX_AUDIO_BATCH_FILES),
  async (req: Request, res: Response): Promise<void> => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const debugLevel = parseDebugLevel(req.query.debug as string | undefined);
    const debugInfo = debugLevel ? createDebugInfo(debugLevel, requestId) : undefined;
    const fileContexts: Array<{
      inputFile: Express.Multer.File;
      ext: string;
      detectedFormat: string | null;
      tempPath: string;
      baseName: string;
      durationSeconds: number;
    }> = [];

    try {
      const manifestRaw = req.body?.manifest;
      if (!manifestRaw || typeof manifestRaw !== 'string') {
        res.status(400).json({ error: 'Missing manifest JSON in form field "manifest"', debug: debugInfo });
        return;
      }

      let manifestJson: unknown;
      try {
        manifestJson = JSON.parse(manifestRaw);
      } catch {
        res.status(400).json({ error: 'Invalid manifest JSON', debug: debugInfo });
        return;
      }

      const parsedManifest = audioBatchManifestSchema.safeParse(manifestJson);
      if (!parsedManifest.success) {
        const errors = parsedManifest.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
        res.status(400).json({ error: 'Invalid manifest', details: errors, debug: debugInfo });
        return;
      }

      const manifest = parsedManifest.data;
      const files = (req.files || []) as Express.Multer.File[];

      if (files.length === 0) {
        res.status(400).json({ error: 'No audio files provided', debug: debugInfo });
        return;
      }

      if (files.length > env.MAX_AUDIO_BATCH_FILES) {
        res.status(400).json({
          error: `Too many files. Max ${env.MAX_AUDIO_BATCH_FILES}`,
          debug: debugInfo,
        });
        return;
      }

      for (const item of manifest.outputs) {
        if (item.variants.length > env.MAX_AUDIO_VARIANTS_PER_FILE) {
          res.status(400).json({
            error: `Too many variants for ${item.file}. Max ${env.MAX_AUDIO_VARIANTS_PER_FILE}`,
            debug: debugInfo,
          });
          return;
        }
      }

      const fileMap = new Map(files.map((f) => [f.originalname, f]));
      for (const item of manifest.outputs) {
        if (!fileMap.has(item.file)) {
          res.status(400).json({
            error: `Manifest references missing file: ${item.file}`,
            debug: debugInfo,
          });
          return;
        }
      }

      for (const item of manifest.outputs) {
        const inputFile = fileMap.get(item.file)!;
        const ext = path.extname(inputFile.originalname).toLowerCase().slice(1);
        if (ext && !validateAudioExtension(ext)) {
          res.status(400).json({
            error: `Unsupported audio format: ${ext}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
            debug: debugInfo,
          });
          return;
        }

        const detectedFormat = detectAudioFormat(inputFile.buffer);
        if (detectedFormat && !validateAudioExtension(detectedFormat)) {
          res.status(400).json({
            error: `Unsupported audio format: ${detectedFormat}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
            debug: debugInfo,
          });
          return;
        }

        const tempPath = await createTempAudioFile(inputFile.buffer, ext);
        const durationSeconds = await getAudioDurationSeconds(tempPath);
        fileContexts.push({
          inputFile,
          ext,
          detectedFormat,
          tempPath,
          baseName: sanitizeName(path.parse(inputFile.originalname).name),
          durationSeconds,
        });
      }

      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename="audio-peaks.zip"');
      res.set('X-Request-Id', requestId);
      if (debugInfo) {
        res.set('X-Debug-Level', debugInfo.level);
      }

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err) => {
        logger.error({ requestId, err }, 'Zip archive error');
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to create zip', debug: debugInfo });
        }
      });

      archive.pipe(res);

      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      const debugSummary: AudioBatchDebugSummary | null = debugInfo
        ? { ...debugInfo, files: [] }
        : null;

      for (const item of manifest.outputs) {
        const ctx = fileContexts.find((c) => c.inputFile.originalname === item.file);
        if (!ctx) {
          continue;
        }

        const fileDebug: AudioFileDebug = {
          file: ctx.inputFile.originalname,
          sizeBytes: ctx.inputFile.size,
          detectedFormat: ctx.detectedFormat || null,
          durationSeconds: ctx.durationSeconds,
          variants: [],
        };

        for (const variant of item.variants) {
          const variantStart = Date.now();
          const samplesPerMinute = variant.samplesPerMinute ?? 120;
          const samples =
            variant.samples ?? Math.round((ctx.durationSeconds / 60) * samplesPerMinute);

          if (samples <= 0 || samples > 10000) {
            await cleanupTempFile(ctx.tempPath);
            res.status(400).json({
              error: `Invalid samples configuration for ${ctx.inputFile.originalname}`,
              debug: debugInfo,
            });
            return;
          }

          const peaks = await extractPeaksWithAudiowaveform(ctx.tempPath, samples);
          const defaultName = `${ctx.baseName}_${samples}.json`;
          const fileName = sanitizeName(variant.name || defaultName);
          const entryPath = `peaks/${ctx.baseName}/${fileName}`;

          archive.append(JSON.stringify({ peaks, samples }, null, 2), { name: entryPath });

          if (debugSummary) {
            const variantDebug: AudioVariantDebug = {
              name: entryPath,
              samples,
              samplesPerMinute,
              durationMs: Date.now() - variantStart,
              peaksCount: peaks.length,
            };
            fileDebug.variants.push(variantDebug);
          }
        }

        await cleanupTempFile(ctx.tempPath);

        if (debugSummary) {
          debugSummary.files.push(fileDebug);
        }
      }

      if (debugSummary) {
        debugSummary.durationMs = Date.now() - startedAt;
        res.set('X-Processing-Time-Ms', debugSummary.durationMs.toString());
        res.set('X-Debug-Info', encodeDebugInfo(debugSummary));
        archive.append(JSON.stringify(debugSummary, null, 2), { name: 'debug.json' });
      }

      await archive.finalize();
    } catch (error) {
      for (const ctx of fileContexts) {
        await cleanupTempFile(ctx.tempPath);
      }
      logger.error({ requestId, err: error }, 'Audio batch error');
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Failed to process audio batch',
          details: error instanceof Error ? error.message : 'Unknown error',
          debug: debugInfo,
        });
      }
    }
  }
);

function sanitizeName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_');
}

export default router;
