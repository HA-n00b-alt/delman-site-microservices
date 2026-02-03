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

describe('CORS Middleware', () => {
  it('should allow requests without Origin header (non-browser clients)', async () => {
    const response = await request(server)
      .get('/health');

    // Health endpoint returns 200 (ok) or 503 (degraded) depending on audiowaveform availability
    expect([200, 503]).toContain(response.status);
    // No CORS headers should be set when no Origin is provided
  });

  it('should allow requests with valid Origin header', async () => {
    const response = await request(server)
      .get('/health')
      .set('Origin', 'http://localhost:3000');

    // Health endpoint returns 200 (ok) or 503 (degraded) depending on audiowaveform availability
    expect([200, 503]).toContain(response.status);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('should reject requests with invalid Origin header', async () => {
    const response = await request(server)
      .get('/health')
      .set('Origin', 'http://malicious-site.com');

    // Request still succeeds but no CORS headers for invalid origin
    expect([200, 503]).toContain(response.status);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('should handle preflight OPTIONS requests for valid origins', async () => {
    const response = await request(server)
      .options('/v1/image/convert')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'X-Api-Key');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('should expose custom headers in CORS response', async () => {
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const response = await request(server)
      .post('/v1/image/convert')
      .set('X-Api-Key', API_KEY)
      .set('Origin', 'http://localhost:3000')
      .attach('image', pngBuffer, 'test.png');

    expect(response.status).toBe(200);
    const exposedHeaders = response.headers['access-control-expose-headers'];
    expect(exposedHeaders).toContain('X-Debug-Info');
    expect(exposedHeaders).toContain('X-Request-Id');
    expect(exposedHeaders).toContain('X-Processing-Time-Ms');
  });
});

describe('Rate Limiting Middleware', () => {
  it('should include rate limit headers in response', async () => {
    const response = await request(server).get('/health');

    // Health endpoint returns 200 (ok) or 503 (degraded) depending on audiowaveform availability
    expect([200, 503]).toContain(response.status);
    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['ratelimit-remaining']).toBeDefined();
  });

  it('should allow requests within rate limit', async () => {
    // Make a few requests, all should succeed
    for (let i = 0; i < 5; i++) {
      const response = await request(server).get('/health');
      expect(response.status).not.toBe(429);
    }
  });
});

describe('Environment Configuration', () => {
  it('should have validated environment variables', async () => {
    // The app should start successfully with valid env vars
    const response = await request(server).get('/health');
    expect([200, 503]).toContain(response.status);
  });
});
