import { DebugInfo, DebugLevel, DEBUG_LEVELS, DebugStep } from '../types';

export function parseDebugLevel(value?: string): DebugLevel | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (DEBUG_LEVELS.includes(normalized as DebugLevel)) {
    return normalized as DebugLevel;
  }
  return undefined;
}

export function createDebugInfo(level: DebugLevel, requestId: string): DebugInfo {
  return {
    level,
    requestId,
    startedAt: new Date().toISOString(),
    steps: [],
  };
}

export function recordStep(debugInfo: DebugInfo | undefined, name: string, stepStart: number): void {
  if (!debugInfo?.steps) return;
  debugInfo.steps.push({ name, durationMs: Date.now() - stepStart });
}

export function encodeDebugInfo(debugInfo: DebugInfo | Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(debugInfo)).toString('base64');
}
