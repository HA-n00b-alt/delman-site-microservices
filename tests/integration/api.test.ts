import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index';

const API_KEY = 'test-api-key';

describe('Health Endpoint', () => {
  it('GET /health should return health status', async () => {
    const response = await request(app).get('/health');

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
    const response = await request(app).get('/health');
    expect(response.status).not.toBe(401);
  });
});

describe('API Documentation', () => {
  it('GET /api-docs should return Swagger UI', async () => {
    const response = await request(app).get('/api-docs/').redirects(1);
    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger');
  });

  it('GET /api-docs.json should return OpenAPI spec', async () => {
    const response = await request(app).get('/api-docs.json');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('openapi');
    expect(response.body).toHaveProperty('info');
    expect(response.body).toHaveProperty('paths');
  });
});

describe('Authentication', () => {
  it('should reject requests without API key', async () => {
    const response = await request(app).post('/v1/image/convert');
    expect(response.status).toBe(401);
    expect(response.body.error).toContain('Unauthorized');
  });

  it('should reject requests with invalid API key', async () => {
    const response = await request(app)
      .post('/v1/image/convert')
      .set('X-Api-Key', 'wrong-key');
    expect(response.status).toBe(401);
  });
});

describe('Image Conversion Endpoint', () => {
  it('POST /v1/image/convert should require image file', async () => {
    const response = await request(app)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('No image file provided');
  });

  it('POST /v1/image/convert should reject invalid format', async () => {
    // Create a 1x1 red PNG
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const response = await request(app)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY)
      .query({ format: 'bmp' })
      .attach('image', pngBuffer, 'test.png');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid parameters');
  });

  it('POST /v1/image/convert should convert image successfully', async () => {
    // Create a 1x1 red PNG
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const response = await request(app)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY)
      .query({ format: 'webp' })
      .attach('image', pngBuffer, 'test.png');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('POST /v1/image/convert should resize image', async () => {
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const response = await request(app)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY)
      .query({ width: '100', height: '100' })
      .attach('image', pngBuffer, 'test.png');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
  });

  it('POST /v1/image/convert should include debug info when requested', async () => {
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const response = await request(app)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY)
      .query({ debug: 'info' })
      .attach('image', pngBuffer, 'test.png');

    expect(response.status).toBe(200);
    expect(response.headers['x-debug-level']).toBe('info');
    expect(response.headers['x-processing-time-ms']).toBeDefined();
    expect(response.headers['x-debug-info']).toBeDefined();
  });
});

describe('Audio Peaks Endpoint', () => {
  it('POST /v1/audio/peaks should require audio file', async () => {
    const response = await request(app)
      .post('/v1/audio/peaks')
      .set('X-Api-Key', API_KEY);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('No audio file provided');
  });

  it('POST /v1/audio/peaks should reject invalid samples parameter', async () => {
    // Minimal WAV header
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

    const response = await request(app)
      .post('/v1/audio/peaks')
      .set('X-Api-Key', API_KEY)
      .query({ samples: '99999' })
      .attach('audio', wavBuffer, 'test.wav');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid parameters');
  });
});

describe('Legacy Routes (Backward Compatibility)', () => {
  it('POST /image/convert should work without /v1 prefix', async () => {
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const response = await request(app)
      .post('/image/convert')
      .set('X-Api-Key', API_KEY)
      .attach('image', pngBuffer, 'test.png');

    expect(response.status).toBe(200);
  });
});

describe('404 Handler', () => {
  it('should return 404 for unknown routes', async () => {
    const response = await request(app)
      .get('/unknown-route')
      .set('X-Api-Key', API_KEY);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Not found');
  });
});
