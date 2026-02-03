import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import request from 'supertest';
import { app } from '../../src/index';

const API_KEY = 'test-api-key';

let server: http.Server;

beforeAll(() => {
  return new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => resolve());
  });
});

afterAll(() => {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('Health Endpoint', () => {
  it('GET /health should return health status', async () => {
    const response = await request(server).get('/health');

    // Status can be 200 (ok) or 503 (degraded) depending on environment
    expect([200, 503]).toContain(response.status);
    expect(response.body).toHaveProperty('status');
    expect(['ok', 'degraded']).toContain(response.body.status);
    expect(response.body).toHaveProperty('checks');
    expect(response.body).toHaveProperty('uptime');
    expect(response.body.checks).toHaveProperty('sharp');
    expect(response.body.checks).toHaveProperty('audiowaveform');
  });

  it('GET /health should not require API key', async () => {
    const response = await request(server).get('/health');
    expect(response.status).not.toBe(401);
  });
});

describe('API Documentation', () => {
  it('GET /api-docs should return Swagger UI', async () => {
    const response = await request(server).get('/api-docs/').redirects(1);
    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger');
  });

  it('GET /api-docs.json should return OpenAPI spec', async () => {
    const response = await request(server).get('/api-docs.json');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('openapi');
    expect(response.body).toHaveProperty('info');
    expect(response.body).toHaveProperty('paths');
  });
});

describe('Authentication', () => {
  it('should reject requests without API key', async () => {
    const response = await request(server).post('/v1/image/convert');
    expect(response.status).toBe(401);
    expect(response.body.error).toContain('Unauthorized');
  });

  it('should reject requests with invalid API key', async () => {
    const response = await request(server)
      .post('/v1/image/convert')
      .set('X-Api-Key', 'wrong-key');
    expect(response.status).toBe(401);
  });
});

describe('Image Conversion Endpoint', () => {
  it('POST /v1/image/convert should require image file', async () => {
    const response = await request(server)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('No image file provided');
  });

  it('POST /v1/image/convert should reject invalid format', async () => {
    const response = await request(server)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY)
      .query({ format: 'bmp' })
      .attach('image', MINIMAL_PNG, 'test.png');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid parameters');
  });

  it('POST /v1/image/convert should convert image successfully', async () => {
    const response = await request(server)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY)
      .query({ format: 'webp' })
      .attach('image', MINIMAL_PNG, 'test.png');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('POST /v1/image/convert should resize image', async () => {
    const response = await request(server)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY)
      .query({ width: '100', height: '100' })
      .attach('image', MINIMAL_PNG, 'test.png');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
  });

  it('POST /v1/image/convert should include debug info when requested', async () => {
    const response = await request(server)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY)
      .query({ debug: 'info' })
      .attach('image', MINIMAL_PNG, 'test.png');

    expect(response.status).toBe(200);
    expect(response.headers['x-debug-level']).toBe('info');
    expect(response.headers['x-processing-time-ms']).toBeDefined();
    expect(response.headers['x-debug-info']).toBeDefined();
  });
});

describe('Audio Peaks Endpoint', () => {
  it('POST /v1/audio/peaks should require audio file', async () => {
    const response = await request(server)
      .post('/v1/audio/peaks')
      .set('X-Api-Key', API_KEY);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('No audio file provided');
  });

  it('POST /v1/audio/peaks should reject invalid samples parameter', async () => {
    const wavBuffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // file size
      0x57, 0x41, 0x56, 0x45, // WAVE
      0x66, 0x6d, 0x74, 0x20, // fmt
      0x10, 0x00, 0x00, 0x00, // chunk size
      0x01, 0x00,             // audio format
      0x01, 0x00,             // channels
      0x44, 0xac, 0x00, 0x00, // sample rate
      0x88, 0x58, 0x01, 0x00, // byte rate
      0x02, 0x00,             // block align
      0x10, 0x00,             // bits per sample
      0x64, 0x61, 0x74, 0x61, // data
      0x00, 0x00, 0x00, 0x00, // data size
    ]);

    const response = await request(server)
      .post('/v1/audio/peaks')
      .set('X-Api-Key', API_KEY)
      .query({ samples: '99999' })
      .attach('audio', wavBuffer, 'test.wav');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid parameters');
  });
});

describe('Image Batch Endpoint', () => {
  it('POST /v1/image/batch should require manifest', async () => {
    const response = await request(server)
      .post('/v1/image/batch')
      .set('X-Api-Key', API_KEY)
      .attach('images', MINIMAL_PNG, 'test.png');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('manifest');
  });

  it('POST /v1/image/batch should require image files', async () => {
    const manifest = { outputs: [{ file: 'test.png', variants: [{ format: 'webp' }] }] };
    const response = await request(server)
      .post('/v1/image/batch')
      .set('X-Api-Key', API_KEY)
      .field('manifest', JSON.stringify(manifest));

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('No image files');
  });

  it('POST /v1/image/batch should return zip with manifest and converted images', async () => {
    const manifest = {
      outputs: [
        {
          file: 'test.png',
          variants: [
            { format: 'webp', width: 100, height: 100, fit: 'cover' },
            { format: 'jpg', name: 'thumb.jpg' },
          ],
        },
      ],
    };

    const response = await request(server)
      .post('/v1/image/batch')
      .set('X-Api-Key', API_KEY)
      .field('manifest', JSON.stringify(manifest))
      .attach('images', MINIMAL_PNG, 'test.png');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.headers['x-request-id']).toBeDefined();
    // Response body may be buffer or parsed; ensure we got a non-empty response
    const size =
      (response.headers['content-length'] && Number(response.headers['content-length'])) ||
      (Buffer.isBuffer(response.body) ? response.body.length : 0) ||
      (typeof response.text === 'string' ? response.text.length : 0);
    expect(size).toBeGreaterThan(0);
  });
});

describe('Audio Batch Endpoint', () => {
  it('POST /v1/audio/peaks/batch should require manifest', async () => {
    const wavBuffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
      0x44, 0xac, 0x00, 0x00, 0x88, 0x58, 0x01, 0x00, 0x02, 0x00, 0x10, 0x00,
      0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
    ]);
    const response = await request(server)
      .post('/v1/audio/peaks/batch')
      .set('X-Api-Key', API_KEY)
      .attach('audio', wavBuffer, 'test.wav');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('manifest');
  });

  it('POST /v1/audio/peaks/batch should require audio files', async () => {
    const manifest = {
      outputs: [{ file: 'test.wav', variants: [{ samplesPerMinute: 120 }] }],
    };
    const response = await request(server)
      .post('/v1/audio/peaks/batch')
      .set('X-Api-Key', API_KEY)
      .field('manifest', JSON.stringify(manifest));

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('No audio files');
  });
});

describe('Legacy Routes (Backward Compatibility)', () => {
  it('POST /image/convert should work without /v1 prefix', async () => {
    const response = await request(server)
      .post('/image/convert')
      .set('X-Api-Key', API_KEY)
      .attach('image', MINIMAL_PNG, 'test.png');

    expect(response.status).toBe(200);
  });

  it('POST /audio/peaks should require audio file (legacy path)', async () => {
    const response = await request(server)
      .post('/audio/peaks')
      .set('X-Api-Key', API_KEY);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('No audio file provided');
  });
});

describe('404 Handler', () => {
  it('should return 404 for unknown routes', async () => {
    const response = await request(server)
      .get('/unknown-route')
      .set('X-Api-Key', API_KEY);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Not found');
  });
});
