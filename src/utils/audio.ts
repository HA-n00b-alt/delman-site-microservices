import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { env } from '../config/env';
import { SUPPORTED_AUDIO_FORMATS, AudioFormat } from '../types';

export function detectAudioFormat(buffer: Buffer): AudioFormat | null {
  if (buffer.length < 4) return null;

  // WAV: RIFF....WAVE
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    if (
      buffer.length >= 12 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x41 &&
      buffer[10] === 0x56 &&
      buffer[11] === 0x45
    ) {
      return 'wav';
    }
  }

  // OGG: OggS
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return 'ogg';
  }

  // FLAC: fLaC
  if (buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) {
    return 'flac';
  }

  // WebM: EBML header
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'webm';
  }

  // M4A/MP4: ftyp at offset 4
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'M4A ' || brand === 'isom' || brand === 'mp42' || brand === 'mp41') {
      return 'm4a';
    }
  }

  // MP3 with ID3 tag
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return 'mp3';
  }

  // AAC: ADTS sync word
  if (buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0) {
    return 'aac';
  }

  // MP3: Frame sync
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return 'mp3';
  }

  return null;
}

export function resamplePeaks(peaks: number[], targetSamples: number): number[] {
  if (peaks.length === 0) return [];
  if (peaks.length === targetSamples) return peaks;

  const result: number[] = [];
  const ratio = peaks.length / targetSamples;

  for (let i = 0; i < targetSamples; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);

    let maxPeak = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      maxPeak = Math.max(maxPeak, peaks[j]);
    }

    if (start >= peaks.length) {
      maxPeak = peaks[peaks.length - 1];
    } else if (start === end) {
      maxPeak = peaks[start];
    }

    result.push(Math.round(maxPeak * 1000) / 1000);
  }

  return result;
}

export function extractPeaksWithAudiowaveform(inputPath: string, samples: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i',
      inputPath,
      '--output-format',
      'json',
      '--pixels-per-second',
      env.AUDIOWAVEFORM_PIXELS_PER_SECOND.toString(),
      '-b',
      env.AUDIOWAVEFORM_BITS.toString(),
    ];

    const proc = spawn('audiowaveform', args);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      reject(new Error(`audiowaveform timed out after ${env.AUDIOWAVEFORM_TIMEOUT_MS}ms`));
    }, env.AUDIOWAVEFORM_TIMEOUT_MS);

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
        const rawData: number[] = result.data || [];
        const bits = result.bits || 8;
        const maxVal = bits === 8 ? 128 : 32768;

        const extractedPeaks: number[] = [];
        for (let i = 0; i < rawData.length; i += 2) {
          const min = Math.abs(rawData[i] || 0);
          const max = Math.abs(rawData[i + 1] || 0);
          const peak = Math.max(min, max) / maxVal;
          extractedPeaks.push(Math.min(1, peak));
        }

        const resampled = resamplePeaks(extractedPeaks, samples);
        resolve(resampled);
      } catch (parseError) {
        reject(new Error(`Failed to parse audiowaveform output: ${parseError}`));
      }
    });
  });
}

export function getAudioDurationSeconds(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ];

    const proc = spawn('ffprobe', args);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      reject(new Error(`ffprobe timed out after ${env.AUDIO_DURATION_TIMEOUT_MS}ms`));
    }, env.AUDIO_DURATION_TIMEOUT_MS);

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
      reject(err);
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        return;
      }
      const value = parseFloat(stdout.trim());
      if (Number.isNaN(value) || !Number.isFinite(value)) {
        reject(new Error(`ffprobe returned invalid duration: ${stdout.trim()}`));
        return;
      }
      resolve(value);
    });
  });
}

export async function createTempAudioFile(buffer: Buffer, ext: string): Promise<string> {
  const tempDir = os.tmpdir();
  const safeExt = validateAudioExtension(ext) ? ext : '';
  const tempFileName = `audio_${Date.now()}_${Math.random().toString(36).slice(2)}${safeExt ? '.' + safeExt : ''}`;
  const tempPath = path.join(tempDir, tempFileName);
  await fs.promises.writeFile(tempPath, buffer);
  return tempPath;
}

export async function cleanupTempFile(filePath: string | null): Promise<void> {
  if (filePath) {
    await fs.promises.unlink(filePath).catch(() => {});
  }
}

export function isAudiowaveformAvailable(): boolean {
  try {
    // Use --version which works cross-platform and exits cleanly
    const result = spawnSync('audiowaveform', ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function validateAudioExtension(ext: string): boolean {
  return SUPPORTED_AUDIO_FORMATS.includes(ext as AudioFormat);
}
