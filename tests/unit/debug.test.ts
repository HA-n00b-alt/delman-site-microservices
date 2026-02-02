import { describe, it, expect } from 'vitest';
import { parseDebugLevel, createDebugInfo, recordStep, encodeDebugInfo } from '../../src/utils/debug';

describe('parseDebugLevel', () => {
  it('should return undefined for empty value', () => {
    expect(parseDebugLevel()).toBeUndefined();
    expect(parseDebugLevel('')).toBeUndefined();
  });

  it('should parse valid debug levels', () => {
    expect(parseDebugLevel('debug')).toBe('debug');
    expect(parseDebugLevel('info')).toBe('info');
    expect(parseDebugLevel('warn')).toBe('warn');
    expect(parseDebugLevel('error')).toBe('error');
    expect(parseDebugLevel('crit')).toBe('crit');
  });

  it('should handle case-insensitive input', () => {
    expect(parseDebugLevel('DEBUG')).toBe('debug');
    expect(parseDebugLevel('Info')).toBe('info');
    expect(parseDebugLevel('WARN')).toBe('warn');
  });

  it('should return undefined for invalid levels', () => {
    expect(parseDebugLevel('invalid')).toBeUndefined();
    expect(parseDebugLevel('trace')).toBeUndefined();
    expect(parseDebugLevel('verbose')).toBeUndefined();
  });
});

describe('createDebugInfo', () => {
  it('should create debug info with correct structure', () => {
    const result = createDebugInfo('info', 'test-request-id');
    expect(result.level).toBe('info');
    expect(result.requestId).toBe('test-request-id');
    expect(result.startedAt).toBeDefined();
    expect(result.steps).toEqual([]);
  });

  it('should set ISO timestamp', () => {
    const result = createDebugInfo('debug', 'req-123');
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('recordStep', () => {
  it('should add step to debug info', () => {
    const debugInfo = createDebugInfo('info', 'test-id');
    const stepStart = Date.now() - 100;
    recordStep(debugInfo, 'test_step', stepStart);

    expect(debugInfo.steps).toHaveLength(1);
    expect(debugInfo.steps![0].name).toBe('test_step');
    expect(debugInfo.steps![0].durationMs).toBeGreaterThanOrEqual(100);
  });

  it('should not throw if debugInfo is undefined', () => {
    expect(() => recordStep(undefined, 'test', Date.now())).not.toThrow();
  });

  it('should not throw if steps is undefined', () => {
    const debugInfo = { level: 'info' as const, requestId: 'test', startedAt: '' };
    expect(() => recordStep(debugInfo, 'test', Date.now())).not.toThrow();
  });
});

describe('encodeDebugInfo', () => {
  it('should encode debug info as base64', () => {
    const debugInfo = createDebugInfo('info', 'test-id');
    const encoded = encodeDebugInfo(debugInfo);

    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString());
    expect(decoded.level).toBe('info');
    expect(decoded.requestId).toBe('test-id');
  });
});
