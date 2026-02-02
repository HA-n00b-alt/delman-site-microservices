import { describe, it, expect } from 'vitest';
import { detectAudioFormat, resamplePeaks, validateAudioExtension } from '../../src/utils/audio';

describe('detectAudioFormat', () => {
  it('should detect WAV format', () => {
    // RIFF....WAVE header
    const wavBuffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // file size
      0x57, 0x41, 0x56, 0x45, // WAVE
    ]);
    expect(detectAudioFormat(wavBuffer)).toBe('wav');
  });

  it('should detect OGG format', () => {
    // OggS header
    const oggBuffer = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
    expect(detectAudioFormat(oggBuffer)).toBe('ogg');
  });

  it('should detect FLAC format', () => {
    // fLaC header
    const flacBuffer = Buffer.from([0x66, 0x4c, 0x61, 0x43]);
    expect(detectAudioFormat(flacBuffer)).toBe('flac');
  });

  it('should detect WebM format', () => {
    // EBML header
    const webmBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    expect(detectAudioFormat(webmBuffer)).toBe('webm');
  });

  it('should detect MP3 with ID3 tag', () => {
    const mp3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x00]);
    expect(detectAudioFormat(mp3Buffer)).toBe('mp3');
  });

  it('should detect MP3 frame sync', () => {
    // 0xff 0xe0 is MP3 frame sync (11 set bits), not AAC (0xff 0xf0)
    const mp3Buffer = Buffer.from([0xff, 0xe3, 0x90, 0x00]);
    expect(detectAudioFormat(mp3Buffer)).toBe('mp3');
  });

  it('should detect AAC format', () => {
    const aacBuffer = Buffer.from([0xff, 0xf1, 0x00, 0x00]);
    expect(detectAudioFormat(aacBuffer)).toBe('aac');
  });

  it('should detect M4A format', () => {
    const m4aBuffer = Buffer.from([
      0x00, 0x00, 0x00, 0x00, // size
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x4d, 0x34, 0x41, 0x20, // M4A
    ]);
    expect(detectAudioFormat(m4aBuffer)).toBe('m4a');
  });

  it('should return null for unknown format', () => {
    const unknownBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(detectAudioFormat(unknownBuffer)).toBeNull();
  });

  it('should return null for buffer too small', () => {
    const smallBuffer = Buffer.from([0x00, 0x00]);
    expect(detectAudioFormat(smallBuffer)).toBeNull();
  });
});

describe('resamplePeaks', () => {
  it('should return empty array for empty input', () => {
    expect(resamplePeaks([], 10)).toEqual([]);
  });

  it('should return same array if length matches target', () => {
    const peaks = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(resamplePeaks(peaks, 5)).toEqual(peaks);
  });

  it('should downsample peaks correctly', () => {
    const peaks = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const result = resamplePeaks(peaks, 5);
    expect(result).toHaveLength(5);
    // Should take max of each segment
    expect(result[0]).toBe(0.2); // max of [0.1, 0.2]
    expect(result[1]).toBe(0.4); // max of [0.3, 0.4]
  });

  it('should upsample peaks correctly', () => {
    const peaks = [0.5, 1.0];
    const result = resamplePeaks(peaks, 4);
    expect(result).toHaveLength(4);
  });

  it('should round to 3 decimal places when resampling', () => {
    // When resampling (not same length), values get rounded
    const peaks = [0.12345, 0.67891, 0.11111, 0.99999];
    const result = resamplePeaks(peaks, 2);
    expect(result).toHaveLength(2);
    // Each result is max of a segment, rounded to 3 decimals
    expect(result[0]).toBe(0.679); // max of [0.12345, 0.67891]
    expect(result[1]).toBe(1); // max of [0.11111, 0.99999], clamped to 1
  });
});

describe('validateAudioExtension', () => {
  it('should return true for valid extensions', () => {
    expect(validateAudioExtension('mp3')).toBe(true);
    expect(validateAudioExtension('wav')).toBe(true);
    expect(validateAudioExtension('ogg')).toBe(true);
    expect(validateAudioExtension('flac')).toBe(true);
    expect(validateAudioExtension('aac')).toBe(true);
    expect(validateAudioExtension('m4a')).toBe(true);
    expect(validateAudioExtension('webm')).toBe(true);
  });

  it('should return false for invalid extensions', () => {
    expect(validateAudioExtension('txt')).toBe(false);
    expect(validateAudioExtension('pdf')).toBe(false);
    expect(validateAudioExtension('exe')).toBe(false);
    expect(validateAudioExtension('')).toBe(false);
  });
});
