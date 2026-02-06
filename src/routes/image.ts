import { Router, Request, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'crypto';
import archiver from 'archiver';
import path from 'path';
import { env } from '../config/env';
import {
  imageConvertQuerySchema,
  imageBatchManifestSchema,
  CONTENT_TYPE_MAP,
  OutputFormat,
  DebugInfo,
  ImageBatchDebugSummary,
  ImageFileDebug,
  ImageVariantDebug,
} from '../types';
import { createDebugInfo, recordStep, encodeDebugInfo, parseDebugLevel } from '../utils/debug';
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
 * /v1/image/convert:
 *   post:
 *     summary: Convert and resize images
 *     description: Upload an image to convert it to different formats and/or resize it
 *     tags:
 *       - Image
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: The image file to convert
 *     parameters:
 *       - name: format
 *         in: query
 *         description: Output format
 *         schema:
 *           type: string
 *           enum: [jpg, jpeg, png, webp, avif, tiff, gif]
 *           default: jpg
 *       - name: width
 *         in: query
 *         description: Output width in pixels
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: height
 *         in: query
 *         description: Output height in pixels
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - name: fit
 *         in: query
 *         description: How the image should fit within the dimensions
 *         schema:
 *           type: string
 *           enum: [cover, contain, fill, inside, outside]
 *           default: cover
 *       - name: debug
 *         in: query
 *         description: Debug level for response headers
 *         schema:
 *           type: string
 *           enum: [debug, info, warn, error, crit]
 *     responses:
 *       200:
 *         description: Converted image
 *         content:
 *           image/*:
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
  '/image/convert',
  mediaRateLimitMiddleware,
  upload.single('image'),
  async (req: Request, res: Response): Promise<void> => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let debugInfo: DebugInfo | undefined;

    try {
      // Validate query parameters with Zod
      const queryResult = imageConvertQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        const errors = queryResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
        res.status(400).json({ error: 'Invalid parameters', details: errors });
        return;
      }

      const { format, width, height, fit, debug } = queryResult.data;

      if (debug) {
        debugInfo = createDebugInfo(debug, requestId);
      }

      if (!req.file) {
        logger.warn({ requestId }, 'No image file provided');
        res.status(400).json({ error: 'No image file provided', debug: debugInfo });
        return;
      }

      logger.info(
        { requestId, fileName: req.file.originalname, size: req.file.size, format, width, height },
        'Processing image conversion'
      );

      // Process image with sharp
      const processStart = Date.now();
      let pipeline = sharp(req.file.buffer);
      recordStep(debugInfo, 'sharp_init', processStart);

      // Apply resize if dimensions are provided
      if (width || height) {
        const resizeStart = Date.now();
        pipeline = pipeline.resize({
          width,
          height,
          fit,
        });
        recordStep(debugInfo, 'resize', resizeStart);
      }

      // Convert to output format
      const formatStart = Date.now();
      const sharpFormat = format === 'jpg' ? 'jpeg' : format;
      pipeline = pipeline.toFormat(sharpFormat as keyof sharp.FormatEnum);
      recordStep(debugInfo, 'format', formatStart);

      const bufferStart = Date.now();
      const outputBuffer = await pipeline.toBuffer();
      recordStep(debugInfo, 'to_buffer', bufferStart);

      if (debugInfo) {
        debugInfo.input = {
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
        };
        debugInfo.output = {
          format,
          sizeBytes: outputBuffer.length,
          width,
          height,
          fit,
        };
        debugInfo.durationMs = Date.now() - startedAt;
      }

      logger.info(
        { requestId, outputSize: outputBuffer.length, durationMs: Date.now() - startedAt },
        'Image conversion complete'
      );

      res.set('X-Request-Id', requestId);
      if (debugInfo) {
        res.set('X-Debug-Level', debugInfo.level);
        res.set('X-Processing-Time-Ms', debugInfo.durationMs?.toString() || '0');
        res.set('X-Debug-Info', encodeDebugInfo(debugInfo));
      }

      res.set('Content-Type', CONTENT_TYPE_MAP[format as OutputFormat]);
      res.set('Content-Length', outputBuffer.length.toString());
      res.send(outputBuffer);
    } catch (error) {
      if (debugInfo) {
        debugInfo.error = error instanceof Error ? error.message : 'Unknown error';
        debugInfo.durationMs = Date.now() - startedAt;
      }
      logger.error({ requestId, err: error }, 'Image conversion error');
      res.status(500).json({
        error: 'Failed to process image',
        details: error instanceof Error ? error.message : 'Unknown error',
        debug: debugInfo,
      });
    }
  }
);

/**
 * @openapi
 * /v1/image/batch:
 *   post:
 *     summary: Batch image conversion
 *     description: Upload multiple images and get a ZIP with multiple variants per image
 *     tags:
 *       - Image
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - images
 *               - manifest
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Image files (max 15)
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
 *         description: ZIP archive with converted images
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
  '/image/batch',
  mediaRateLimitMiddleware,
  upload.fields([
    { name: 'images', maxCount: env.MAX_IMAGE_BATCH_FILES },
    { name: 'manifest', maxCount: 1 },
  ]),
  async (req: Request, res: Response): Promise<void> => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const debugLevel = parseDebugLevel(req.query.debug as string | undefined);
    const debugInfo = debugLevel ? createDebugInfo(debugLevel, requestId) : undefined;

    try {
      const files = req.files as { images?: Express.Multer.File[]; manifest?: Express.Multer.File[] } | undefined;
      const manifestFile = files?.manifest?.[0];
      const manifestRaw = manifestFile
        ? (manifestFile.buffer as Buffer).toString('utf8')
        : (req.body?.manifest as string | undefined);
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

      const parsedManifest = imageBatchManifestSchema.safeParse(manifestJson);
      if (!parsedManifest.success) {
        const errors = parsedManifest.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
        res.status(400).json({ error: 'Invalid manifest', details: errors, debug: debugInfo });
        return;
      }

      const manifest = parsedManifest.data;
      const imageFiles = files?.images ?? [];

      if (imageFiles.length === 0) {
        res.status(400).json({ error: 'No image files provided', debug: debugInfo });
        return;
      }

      if (imageFiles.length > env.MAX_IMAGE_BATCH_FILES) {
        res.status(400).json({
          error: `Too many files. Max ${env.MAX_IMAGE_BATCH_FILES}`,
          debug: debugInfo,
        });
        return;
      }

      for (const item of manifest.outputs) {
        if (item.variants.length > env.MAX_IMAGE_VARIANTS_PER_FILE) {
          res.status(400).json({
            error: `Too many variants for ${item.file}. Max ${env.MAX_IMAGE_VARIANTS_PER_FILE}`,
            debug: debugInfo,
          });
          return;
        }
      }

      const fileMap = new Map(imageFiles.map((f) => [f.originalname, f]));
      for (const item of manifest.outputs) {
        if (!fileMap.has(item.file)) {
          res.status(400).json({
            error: `Manifest references missing file: ${item.file}`,
            debug: debugInfo,
          });
          return;
        }
      }

      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename="images.zip"');
      res.set('X-Request-Id', requestId);
      if (debugInfo) {
        res.set('X-Debug-Level', debugInfo.level);
      }

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err: unknown) => {
        logger.error({ requestId, err }, 'Zip archive error');
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to create zip', debug: debugInfo });
        }
      });

      archive.pipe(res);

      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      const debugSummary: ImageBatchDebugSummary | null = debugInfo
        ? { ...debugInfo, files: [] }
        : null;

      for (const item of manifest.outputs) {
        const inputFile = fileMap.get(item.file)!;
        const baseName = sanitizeName(path.parse(inputFile.originalname).name);
        const fileDebug: ImageFileDebug = {
          file: inputFile.originalname,
          sizeBytes: inputFile.size,
          variants: [],
        };

        for (const variant of item.variants) {
          const variantStart = Date.now();
          let pipeline = sharp(inputFile.buffer);

          if (variant.width || variant.height) {
            pipeline = pipeline.resize({
              width: variant.width,
              height: variant.height,
              fit: variant.fit,
            });
          }

          const sharpFormat = variant.format === 'jpg' ? 'jpeg' : variant.format;
          pipeline = pipeline.toFormat(sharpFormat as keyof sharp.FormatEnum);
          const outputBuffer = await pipeline.toBuffer();

          const defaultName = `${baseName}_${variant.width || 'auto'}x${variant.height || 'auto'}_${variant.format}.${variant.format}`;
          const fileName = sanitizeName(variant.name || defaultName);
          const entryPath = `images/${baseName}/${fileName}`;

          archive.append(outputBuffer, { name: entryPath });

          if (debugSummary) {
            const variantDebug: ImageVariantDebug = {
              name: entryPath,
              format: variant.format,
              width: variant.width,
              height: variant.height,
              fit: variant.fit,
              outputBytes: outputBuffer.length,
              durationMs: Date.now() - variantStart,
            };
            fileDebug.variants.push(variantDebug);
          }
        }

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
      logger.error({ requestId, err: error }, 'Image batch error');
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Failed to process image batch',
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
