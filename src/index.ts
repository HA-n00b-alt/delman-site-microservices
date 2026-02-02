import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const app = express();
const PORT = process.env.PORT || 8080;

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// CORS middleware
app.use(cors());

// API Key middleware
const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.SERVICE_API_KEY;

  if (!expectedKey) {
    console.warn('SERVICE_API_KEY environment variable is not set');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }

  next();
};

// Apply API key middleware to all routes
app.use(apiKeyMiddleware);

// Health check endpoint (useful for Cloud Run)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

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
}

// Image conversion endpoint
app.post(
  '/image/convert',
  upload.single('image'),
  async (req: Request<{}, {}, {}, ConvertQuery>, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No image file provided' });
        return;
      }

      const { format, width, height, fit } = req.query;

      // Validate format
      const outputFormat = (format?.toLowerCase() || 'jpg') as OutputFormat;
      if (!SUPPORTED_FORMATS.includes(outputFormat)) {
        res.status(400).json({
          error: `Unsupported format: ${format}. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`,
        });
        return;
      }

      // Parse and validate dimensions
      const parsedWidth = width ? parseInt(width, 10) : undefined;
      const parsedHeight = height ? parseInt(height, 10) : undefined;

      if (width && (isNaN(parsedWidth!) || parsedWidth! <= 0)) {
        res.status(400).json({ error: 'Invalid width parameter' });
        return;
      }

      if (height && (isNaN(parsedHeight!) || parsedHeight! <= 0)) {
        res.status(400).json({ error: 'Invalid height parameter' });
        return;
      }

      // Validate fit option
      const fitOption = (fit?.toLowerCase() || 'cover') as FitOption;
      if (fit && !VALID_FIT_OPTIONS.includes(fitOption)) {
        res.status(400).json({
          error: `Invalid fit option: ${fit}. Valid options: ${VALID_FIT_OPTIONS.join(', ')}`,
        });
        return;
      }

      // Process image with sharp
      let pipeline = sharp(req.file.buffer);

      // Apply resize if dimensions are provided
      if (parsedWidth || parsedHeight) {
        pipeline = pipeline.resize({
          width: parsedWidth,
          height: parsedHeight,
          fit: fitOption,
        });
      }

      // Convert to output format
      const sharpFormat = outputFormat === 'jpg' ? 'jpeg' : outputFormat;
      pipeline = pipeline.toFormat(sharpFormat as keyof sharp.FormatEnum);

      const outputBuffer = await pipeline.toBuffer();

      // Set response headers and send buffer
      res.set('Content-Type', CONTENT_TYPE_MAP[outputFormat]);
      res.set('Content-Length', outputBuffer.length.toString());
      res.send(outputBuffer);
    } catch (error) {
      console.error('Image conversion error:', error);
      res.status(500).json({
        error: 'Failed to process image',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

// Supported audio formats
const SUPPORTED_AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'webm'];

interface AudioPeaksQuery {
  samples?: string; // Number of peaks to return
}

// Audio peaks endpoint using audiowaveform binary
app.post(
  '/audio/peaks',
  upload.single('audio'),
  async (req: Request<{}, {}, {}, AudioPeaksQuery>, res: Response): Promise<void> => {
    let tempInputPath: string | null = null;

    try {
      if (!req.file) {
        res.status(400).json({ error: 'No audio file provided' });
        return;
      }

      // Validate file extension
      const ext = path.extname(req.file.originalname).toLowerCase().slice(1);
      if (ext && !SUPPORTED_AUDIO_FORMATS.includes(ext)) {
        res.status(400).json({
          error: `Unsupported audio format: ${ext}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
        });
        return;
      }

      // Parse samples parameter (default 800 peaks for a typical waveform display)
      const samples = req.query.samples ? parseInt(req.query.samples, 10) : 800;
      if (isNaN(samples) || samples <= 0 || samples > 10000) {
        res.status(400).json({ error: 'Invalid samples parameter. Must be between 1 and 10000.' });
        return;
      }

      // Write buffer to temp file (audiowaveform needs file input for reliable format detection)
      const tempDir = os.tmpdir();
      const tempFileName = `audio_${Date.now()}_${Math.random().toString(36).slice(2)}${ext ? '.' + ext : ''}`;
      tempInputPath = path.join(tempDir, tempFileName);

      await fs.promises.writeFile(tempInputPath, req.file.buffer);

      // Use audiowaveform to extract peaks
      // audiowaveform outputs JSON with peaks normalized to -128 to 127 (8-bit) or -32768 to 32767 (16-bit)
      const peaks = await extractPeaksWithAudiowaveform(tempInputPath, samples);

      res.json({ peaks, samples: peaks.length });
    } catch (error) {
      console.error('Audio peaks extraction error:', error);
      res.status(500).json({
        error: 'Failed to extract audio peaks',
        details: error instanceof Error ? error.message : 'Unknown error',
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

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('audiowaveform binary not found. Please install it.'));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
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
app.listen(PORT, () => {
  console.log(`Media processing service running on port ${PORT}`);
});
