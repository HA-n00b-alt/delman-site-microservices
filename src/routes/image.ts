import { Router, Request, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'crypto';
import {
  imageConvertQuerySchema,
  CONTENT_TYPE_MAP,
  OutputFormat,
  DebugInfo,
} from '../types';
import { createDebugInfo, recordStep, encodeDebugInfo } from '../utils/debug';
import logger from '../utils/logger';
import { mediaRateLimitMiddleware } from '../middleware/rateLimit';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit (reduces peak memory per request)
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
      const limitInputPixels = 50 * 1024 * 1024; // 50MP - reject huge images that cause OOM
      let pipeline = sharp(req.file.buffer, { limitInputPixels });
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

export default router;
