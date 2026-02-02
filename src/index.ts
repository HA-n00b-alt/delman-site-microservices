import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const app = express();
const PORT = process.env.PORT || 8080;
const SERVICE_API_KEY = process.env.SERVICE_API_KEY;
const AUDIOWAVEFORM_TIMEOUT_MS = Number(process.env.AUDIOWAVEFORM_TIMEOUT_MS || 15000);
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const DEBUG_LEVELS = ['debug', 'info', 'warn', 'error', 'crit'] as const;
type DebugLevel = typeof DEBUG_LEVELS[number];

function parseDebugLevel(value?: string): DebugLevel | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (DEBUG_LEVELS.includes(normalized as DebugLevel)) {
    return normalized as DebugLevel;
  }
  return undefined;
}

type DebugStep = {
  name: string;
  durationMs: number;
};

type DebugInfo = {
  level: DebugLevel;
  requestId: string;
  startedAt: string;
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  steps?: DebugStep[];
  warnings?: string[];
  error?: string;
};

if (!SERVICE_API_KEY) {
  console.error('SERVICE_API_KEY environment variable is not set');
  process.exit(1);
}

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ALLOWED_ORIGINS.length > 0 && !CORS_ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: 'CORS origin not allowed', origin });
    return;
  }
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, false);
    if (CORS_ALLOWED_ORIGINS.length === 0) return callback(null, false);
    if (CORS_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  exposedHeaders: ['X-Debug-Info', 'X-Debug-Level', 'X-Request-Id', 'X-Processing-Time-Ms'],
}));

// Health check endpoint (useful for Cloud Run)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// API Key middleware
const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'];

  if (typeof apiKey !== 'string') {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }

  const expected = Buffer.from(SERVICE_API_KEY, 'utf8');
  const received = Buffer.from(apiKey, 'utf8');

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }

  next();
};

// Apply API key middleware to all routes
app.use(apiKeyMiddleware);

// Supported output formats
const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff', 'gif'] as const;
type OutputFormat = typeof SUPPORTED_FORMATS[number];

// Content-Type mapping
const CONTENT_TYPE_MAP: Record<OutputFormat, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  tiff: 'image/tiff',
  gif: 'image/gif',
};

// Valid fit options for sharp
const VALID_FIT_OPTIONS = ['cover', 'contain', 'fill', 'inside', 'outside'] as const;
type FitOption = typeof VALID_FIT_OPTIONS[number];

interface ConvertQuery {
  format?: string;
  width?: string;
  height?: string;
  fit?: string;
  debug?: string;
}

// Image conversion endpoint
app.post(
  '/image/convert',
  upload.single('image'),
  async (req: Request<{}, {}, {}, ConvertQuery>, res: Response): Promise<void> => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const debugLevel = parseDebugLevel(req.query.debug);
    const debugInfo: DebugInfo | undefined = debugLevel
      ? { level: debugLevel, requestId, startedAt: new Date(startedAt).toISOString(), steps: [] }
      : undefined;

    const recordStep = (name: string, stepStart: number) => {
      if (!debugInfo?.steps) return;
      debugInfo.steps.push({ name, durationMs: Date.now() - stepStart });
    };

    try {
      if (!req.file) {
        res.status(400).json({ error: 'No image file provided', debug: debugInfo });
        return;
      }

      const { format, width, height, fit } = req.query;

      // Validate format
      const outputFormat = (format?.toLowerCase() || 'jpg') as OutputFormat;
      if (!SUPPORTED_FORMATS.includes(outputFormat)) {
        res.status(400).json({
          error: `Unsupported format: ${format}. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`,
          debug: debugInfo,
        });
        return;
      }

      // Parse and validate dimensions
      const parsedWidth = width ? parseInt(width, 10) : undefined;
      const parsedHeight = height ? parseInt(height, 10) : undefined;

      if (width && (isNaN(parsedWidth!) || parsedWidth! <= 0)) {
        res.status(400).json({ error: 'Invalid width parameter', debug: debugInfo });
        return;
      }

      if (height && (isNaN(parsedHeight!) || parsedHeight! <= 0)) {
        res.status(400).json({ error: 'Invalid height parameter', debug: debugInfo });
        return;
      }

      // Validate fit option
      const fitOption = (fit?.toLowerCase() || 'cover') as FitOption;
      if (fit && !VALID_FIT_OPTIONS.includes(fitOption)) {
        res.status(400).json({
          error: `Invalid fit option: ${fit}. Valid options: ${VALID_FIT_OPTIONS.join(', ')}`,
          debug: debugInfo,
        });
        return;
      }

      // Process image with sharp
      const processStart = Date.now();
      let pipeline = sharp(req.file.buffer);
      recordStep('sharp_init', processStart);

      // Apply resize if dimensions are provided
      if (parsedWidth || parsedHeight) {
        const resizeStart = Date.now();
        pipeline = pipeline.resize({
          width: parsedWidth,
          height: parsedHeight,
          fit: fitOption,
        });
        recordStep('resize', resizeStart);
      }

      // Convert to output format
      const formatStart = Date.now();
      const sharpFormat = outputFormat === 'jpg' ? 'jpeg' : outputFormat;
      pipeline = pipeline.toFormat(sharpFormat as keyof sharp.FormatEnum);
      recordStep('format', formatStart);

      const bufferStart = Date.now();
      const outputBuffer = await pipeline.toBuffer();
      recordStep('to_buffer', bufferStart);

      if (debugInfo) {
        debugInfo.input = {
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
        };
        debugInfo.output = {
          format: outputFormat,
          sizeBytes: outputBuffer.length,
          width: parsedWidth,
          height: parsedHeight,
          fit: fitOption,
        };
        debugInfo.durationMs = Date.now() - startedAt;
      }

      res.set('X-Request-Id', requestId);
      if (debugInfo) {
        res.set('X-Debug-Level', debugInfo.level);
        res.set('X-Processing-Time-Ms', debugInfo.durationMs?.toString() || '0');
        const encoded = Buffer.from(JSON.stringify(debugInfo)).toString('base64');
        res.set('X-Debug-Info', encoded);
      }

      // Set response headers and send buffer
      res.set('Content-Type', CONTENT_TYPE_MAP[outputFormat]);
      res.set('Content-Length', outputBuffer.length.toString());
      res.send(outputBuffer);
    } catch (error) {
      if (debugInfo) {
        debugInfo.error = error instanceof Error ? error.message : 'Unknown error';
        debugInfo.durationMs = Date.now() - startedAt;
      }
      console.error('Image conversion error:', error);
      res.status(500).json({
        error: 'Failed to process image',
        details: error instanceof Error ? error.message : 'Unknown error',
        debug: debugInfo,
      });
    }
  }
);

// Supported audio formats
const SUPPORTED_AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'webm'];

interface AudioPeaksQuery {
  samples?: string; // Number of peaks to return
  debug?: string;
}

// Audio peaks endpoint using audiowaveform binary
app.post(
  '/audio/peaks',
  upload.single('audio'),
  async (req: Request<{}, {}, {}, AudioPeaksQuery>, res: Response): Promise<void> => {
    let tempInputPath: string | null = null;
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const debugLevel = parseDebugLevel(req.query.debug);
    const debugInfo: DebugInfo | undefined = debugLevel
      ? { level: debugLevel, requestId, startedAt: new Date(startedAt).toISOString(), steps: [] }
      : undefined;

    const recordStep = (name: string, stepStart: number) => {
      if (!debugInfo?.steps) return;
      debugInfo.steps.push({ name, durationMs: Date.now() - stepStart });
    };

    try {
      if (!req.file) {
        res.status(400).json({ error: 'No audio file provided', debug: debugInfo });
        return;
      }

      // Validate file extension
      const extStart = Date.now();
      const ext = path.extname(req.file.originalname).toLowerCase().slice(1);
      if (ext && !SUPPORTED_AUDIO_FORMATS.includes(ext)) {
        res.status(400).json({
          error: `Unsupported audio format: ${ext}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
          debug: debugInfo,
        });
        return;
      }
      recordStep('validate_extension', extStart);

      // Validate audio file signature (magic bytes)
      const detectStart = Date.now();
      const detectedFormat = detectAudioFormat(req.file.buffer);
      if (detectedFormat && !SUPPORTED_AUDIO_FORMATS.includes(detectedFormat)) {
        res.status(400).json({
          error: `Unsupported audio format: ${detectedFormat}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
          debug: debugInfo,
        });
        return;
      }
      if (!detectedFormat && ext && !SUPPORTED_AUDIO_FORMATS.includes(ext)) {
        res.status(400).json({
          error: `Unsupported audio format: ${ext}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
          debug: debugInfo,
        });
        return;
      }
      recordStep('detect_format', detectStart);

      // Parse samples parameter (default 800 peaks for a typical waveform display)
      const samples = req.query.samples ? parseInt(req.query.samples, 10) : 800;
      if (isNaN(samples) || samples <= 0 || samples > 10000) {
        res.status(400).json({
          error: 'Invalid samples parameter. Must be between 1 and 10000.',
          debug: debugInfo,
        });
        return;
      }

      // Write buffer to temp file (audiowaveform needs file input for reliable format detection)
      const tempDir = os.tmpdir();
      const tempFileName = `audio_${Date.now()}_${Math.random().toString(36).slice(2)}${ext ? '.' + ext : ''}`;
      tempInputPath = path.join(tempDir, tempFileName);

      const writeStart = Date.now();
      await fs.promises.writeFile(tempInputPath, req.file.buffer);
      recordStep('write_temp_file', writeStart);

      // Use audiowaveform to extract peaks
      // audiowaveform outputs JSON with peaks normalized to -128 to 127 (8-bit) or -32768 to 32767 (16-bit)
      const extractStart = Date.now();
      const peaks = await extractPeaksWithAudiowaveform(tempInputPath, samples);
      recordStep('extract_peaks', extractStart);

      if (debugInfo) {
        debugInfo.input = {
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          extension: ext || null,
          detectedFormat: detectedFormat || null,
        };
        debugInfo.output = { samplesRequested: samples, samplesReturned: peaks.length };
        debugInfo.durationMs = Date.now() - startedAt;
      }

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
      console.error('Audio peaks extraction error:', error);
      res.status(500).json({
        error: 'Failed to extract audio peaks',
        details: error instanceof Error ? error.message : 'Unknown error',
        debug: debugInfo,
      });
    } finally {
      // Clean up temp file
      if (tempInputPath) {
        fs.promises.unlink(tempInputPath).catch(() => {});
      }
    }
  }
);

function extractPeaksWithAudiowaveform(inputPath: string, samples: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '--output-format', 'json',
      '--pixels-per-second', '10', // Low PPS, we'll resample to desired samples
      '-b', '8', // 8-bit precision
    ];

    const proc = spawn('audiowaveform', args);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      reject(new Error(`audiowaveform timed out after ${AUDIOWAVEFORM_TIMEOUT_MS}ms`));
    }, AUDIOWAVEFORM_TIMEOUT_MS);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('audiowaveform binary not found. Please install it.'));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`audiowaveform exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        // audiowaveform returns min/max pairs in the data array
        // We'll extract absolute max values and normalize to 0-1 range
        const rawData: number[] = result.data || [];
        const bits = result.bits || 8;
        const maxVal = bits === 8 ? 128 : 32768;

        // Extract peaks (take max of absolute min/max for each pair)
        const extractedPeaks: number[] = [];
        for (let i = 0; i < rawData.length; i += 2) {
          const min = Math.abs(rawData[i] || 0);
          const max = Math.abs(rawData[i + 1] || 0);
          const peak = Math.max(min, max) / maxVal;
          extractedPeaks.push(Math.min(1, peak)); // Clamp to 0-1
        }

        // Resample to desired number of samples
        const resampled = resamplePeaks(extractedPeaks, samples);
        resolve(resampled);
      } catch (parseError) {
        reject(new Error(`Failed to parse audiowaveform output: ${parseError}`));
      }
    });
  });
}

function detectAudioFormat(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    if (buffer.length >= 12 &&
      buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
      return 'wav';
    }
  }

  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return 'ogg';
  }

  if (buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) {
    return 'flac';
  }

  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'webm';
  }

  if (buffer.length >= 12 &&
    buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'M4A ' || brand === 'isom' || brand === 'mp42' || brand === 'mp41') {
      return 'm4a';
    }
  }

  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return 'mp3';
  }

  if (buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0) {
    return 'aac';
  }

  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return 'mp3';
  }

  return null;
}

function resamplePeaks(peaks: number[], targetSamples: number): number[] {
  if (peaks.length === 0) return [];
  if (peaks.length === targetSamples) return peaks;

  const result: number[] = [];
  const ratio = peaks.length / targetSamples;

  for (let i = 0; i < targetSamples; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);

    // Take the maximum peak in this segment
    let maxPeak = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      maxPeak = Math.max(maxPeak, peaks[j]);
    }

    // If segment is empty, interpolate
    if (start >= peaks.length) {
      maxPeak = peaks[peaks.length - 1];
    } else if (start === end) {
      maxPeak = peaks[start];
    }

    result.push(Math.round(maxPeak * 1000) / 1000); // Round to 3 decimal places
  }

  return result;
}

// 404 handler for unknown routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler - must be last middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);

  // Handle multer errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }

  // Handle all other errors
  res.status(500).json({
    error: 'Internal server error',
    details: err.message || 'Unknown error',
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Media processing service running on port ${PORT}`);
});

const shutdown = (signal: NodeJS.Signals) => {
  console.log(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
