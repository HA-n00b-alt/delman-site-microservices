# Media Processing Microservice

A Node.js Express microservice for image conversion and audio processing, designed to run on Google Cloud Run.

## Features

- **Image Processing**
  - Convert images between formats (JPEG, PNG, WebP, AVIF, TIFF, GIF)
  - HEIC/HEIF input support
  - Resize images with configurable dimensions and fit modes
- **Audio Processing**
  - Extract audio waveform peaks for visualization
- **Odesli (Songlink)**
  - Query Odesli API with a Spotify or other music link; returns universal links response (no API key required for Odesli)
- **Security**
  - API key authentication (timing-safe comparison)
  - CORS validation with explicit origin whitelist
  - Rate limiting (100 req/min global, 30 req/min for media endpoints)
- **Developer Experience**
  - OpenAPI/Swagger documentation at `/api-docs`
  - Structured JSON logging with Pino
  - Input validation with Zod schemas
  - Comprehensive test suite (78 tests: unit + integration)
- **Production Ready**
  - API versioning (`/v1/` prefix)
  - Deep health checks
  - Graceful shutdown handling
  - Optimized for Cloud Run deployment

## Prerequisites

- **Node.js 20+** and **npm**
- For **local** audio processing (running the app outside Docker): **audiowaveform** and **ffmpeg**

### Installing audiowaveform (local only)

**macOS:**
```bash
brew install audiowaveform
```

**Ubuntu/Debian:** Use your distro’s package manager or build from source.  
**From source:** See [audiowaveform GitHub](https://github.com/bbc/audiowaveform)

**Note:** The Docker image builds and includes audiowaveform, ffmpeg, and all image/audio dependencies (including HEIC/HEVC support). No local install needed when running via Docker.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run (requires SERVICE_API_KEY env var)
SERVICE_API_KEY=your-secret-key npm start
```

## Development

```bash
# Watch mode (rebuild on changes)
npm run dev

# Run tests (requires network for integration tests — server binds to a port)
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Lint
npm run lint

# Type check without emitting
npm run typecheck
```

### Testing

| What | Command | Notes |
|------|---------|--------|
| Unit + integration (Vitest) | `npm test` | Needs network (supertest binds a server). 78 tests. |
| Live API (deployed service) | `./tests/test-api.sh` | Requires `SERVICE_API_KEY` in `.env` or environment. Optionally set `BASE_URL` (default in script). |

**Live script** exercises: auth (401), health, image convert (HEIC→webp), audio peaks. Ensure `tests/data/` contains the sample HEIC and audio files referenced in the script.

## API Documentation

Interactive API documentation is available at `/api-docs` when the server is running.

OpenAPI spec JSON is available at `/api-docs.json`.

The OpenAPI docs include the image convert, audio peaks, and Odesli endpoints.

## API

### Base URLs

| Version | Base Path | Status |
|---------|-----------|--------|
| v1 | `/v1` | Current |
| Legacy | `/` | Deprecated (backward compatible) |

### Authentication

All endpoints (except `/health` and `/api-docs`) require the `X-Api-Key` header with a valid API key matching the `SERVICE_API_KEY` environment variable.

### Rate Limiting

| Endpoint Type | Limit |
|---------------|-------|
| Global | 100 requests/minute |
| Media processing (`/image/convert`, `/audio/peaks`) | 30 requests/minute |
| Odesli (`/odesli`) | Global (100 requests/minute) |

Note: rate limiting uses an in-memory store. With multiple Cloud Run instances, effective limits scale with instance count. For strict global limits, use a shared store (e.g., Redis) or lower per-instance limits.

### Debug Output

Add a `debug` query parameter with one of: `debug`, `info`, `warn`, `error`, `crit`.

- `POST /v1/image/convert?debug=info` returns image bytes and debug info via headers:
  - `X-Request-Id`
  - `X-Debug-Level`
  - `X-Processing-Time-Ms`
  - `X-Debug-Info` (base64 JSON)
- `POST /v1/audio/peaks?debug=info` includes a `debug` field in the JSON response.
- Errors include a `debug` field when debug is requested.

Decode the image debug header (browser):
```ts
const debugHeader = res.headers.get('X-Debug-Info');
const debug = debugHeader ? JSON.parse(atob(debugHeader)) : null;
```

Decode the image debug header (Node):
```ts
const debugHeader = res.headers.get('X-Debug-Info');
const debug = debugHeader
  ? JSON.parse(Buffer.from(debugHeader, 'base64').toString('utf8'))
  : null;
```

### Endpoints

#### `GET /health`

Health check endpoint (no authentication required).

**Response:**
```json
{
  "status": "ok",
  "checks": {
    "audiowaveform": true,
    "sharp": true
  },
  "uptime": 3600
}
```

| Status Code | Meaning |
|-------------|---------|
| 200 | All checks passing |
| 503 | One or more checks failing (degraded) |

#### `POST /v1/image/convert`

Convert and optionally resize an image.

**Content-Type:** `multipart/form-data`

**Form Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| image | file | Yes | The image file to convert |

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| format | string | jpg | Output format: `jpg`, `png`, `webp`, `avif`, `tiff`, `gif` |
| width | number | - | Target width in pixels |
| height | number | - | Target height in pixels |
| fit | string | cover | Resize fit mode: `cover`, `contain`, `fill`, `inside`, `outside` |
| debug | string | - | Debug level: `debug`, `info`, `warn`, `error`, `crit` |

**Response:** Binary image data with appropriate `Content-Type` header.

**Example:**
```bash
curl -X POST "http://localhost:8080/v1/image/convert?format=webp&width=800&height=600&fit=cover" \
  -H "X-Api-Key: your-secret-key" \
  -F "image=@input.heic" \
  --output output.webp
```

#### `POST /v1/audio/peaks`

Extract waveform peaks from an audio file for visualization.

**Content-Type:** `multipart/form-data`

**Form Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| audio | file | Yes | The audio file to process |

**Supported Audio Formats:** MP3, WAV, OGG, FLAC, AAC, M4A, WebM

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| samples | number | - | Number of peaks to return (1-10000). Overrides `samplesPerMinute`. |
| samplesPerMinute | number | 120 | Peaks per minute of audio if `samples` is not provided |
| debug | string | - | Debug level: `debug`, `info`, `warn`, `error`, `crit` |

**Response:**
```json
{
  "peaks": [0.123, 0.456, 0.789, ...],
  "samples": 800
}
```

The `peaks` array contains floating-point numbers between 0 and 1, representing the normalized amplitude at each sample point. These values are suitable for rendering waveform visualizations.

**Example:**
```bash
curl -X POST "http://localhost:8080/v1/audio/peaks?samples=500" \
  -H "X-Api-Key: your-secret-key" \
  -F "audio=@song.mp3"
```

#### `GET /v1/odesli`

Query the [Odesli (Songlink) API](https://linktree.notion.site/API-d0ebe08a5e304a55928405eb682f6741) with a music URL (e.g. Spotify track/album/artist) and return the universal links response (links to the same content on multiple platforms). Odesli does not issue API keys; the API is called without authentication.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string | Yes | Full music URL (Spotify, Apple Music, Deezer, Tidal, YouTube, SoundCloud, Amazon Music, or song.link/odesli.co) |

**Response:** JSON from Odesli (e.g. `entityByUniqueId`, `linksByPlatform`, `pageUrl`).

**Example:**
```bash
curl -s "http://localhost:8080/v1/odesli?url=https://open.spotify.com/track/1GZH9Sv6zCIse2GKihRHKy" \
  -H "X-Api-Key: your-secret-key"
```

| Status Code | Meaning |
|-------------|---------|
| 200 | Odesli response returned |
| 400 | Missing or invalid `url` (not a supported music link) |
| 502 | Odesli API error or unreachable |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| SERVICE_API_KEY | Yes | - | API key for authentication |
| PORT | No | 8080 | Server port (Cloud Run sets `PORT`) |
| CORS_ALLOWED_ORIGINS | Yes (prod) | - | Comma-separated list of allowed origins (no wildcard). Refuses start in production if unset. |
| RATE_LIMIT_WINDOW_MS | No | 60000 | Global rate limit window in ms |
| RATE_LIMIT_MAX_REQUESTS | No | 100 | Max requests per window (global) |
| MEDIA_RATE_LIMIT_MAX_REQUESTS | No | 30 | Max requests per window for media endpoints |
| AUDIOWAVEFORM_TIMEOUT_MS | No | 15000 | Timeout for audiowaveform in ms |
| AUDIO_DURATION_TIMEOUT_MS | No | 5000 | Timeout for ffprobe duration lookup in ms |
| LOG_LEVEL | No | info | Logging level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| ODESLI_API_BASE_URL | No | https://api.song.link | Odesli API base URL (used without API key) |

In production, the service refuses to start if `CORS_ALLOWED_ORIGINS` is empty.

## Docker

The image is multi-stage: builds audiowaveform and the Node app, then produces a slim production image.

- **Base:** Debian Trixie (`node:trixie` / `node:trixie-slim`) for **libvips 8.16+** and **libheif with HEVC** (libde265), so **HEIC from iPhones** (HEVC-compressed) is supported.
- **Sharp** is pinned to **0.33.x** and built against system libvips (`SHARP_FORCE_GLOBAL_LIBVIPS=1`). Newer sharp (0.34+) requires libvips 8.17.3+, which is not in current Debian stable/Trixie packages.
- **Production image** includes: Node runtime, sharp (system libvips + libheif/libde265), ffmpeg, audiowaveform binary, and runtime libs for audio (libmad, libsndfile, libgd, libboost).

**Build and run locally:**

```bash
docker build -t media-service .
docker run --rm -p 8080:8080 \
  -e SERVICE_API_KEY=your-key \
  -e CORS_ALLOWED_ORIGINS=https://your-site.com \
  media-service
```

**Verify:** `curl -s http://localhost:8080/health`

## Install on GCP (Cloud Run Only)

### 1) GCP Setup

1. Create an Artifact Registry repository:
```bash
gcloud artifacts repositories create media-service \
  --repository-format=docker \
  --location=europe-west1
```

2. Create a Service Account with required roles:
```bash
gcloud iam service-accounts create github-actions

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

3. Generate and download the Service Account key, then add it as `GCP_SA_KEY` secret in GitHub.

### 2) Configure GitHub Actions Secrets

Set these GitHub secrets:

| Secret | Description |
|--------|-------------|
| `GCP_PROJECT_ID` | Your Google Cloud project ID |
| `GCP_SA_KEY` | Service Account JSON key with Cloud Run and Artifact Registry permissions |
| `SERVICE_API_KEY` | API key for the service authentication |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins for your Astro app |

### 3) Deploy (Automated)

Push to `main`. The workflow in `.github/workflows/deploy.yml` builds the Docker image and deploys to Cloud Run.

- **Redeploy:** Push to `main` (or trigger the workflow). The built image includes HEIC/HEVC support (Trixie + sharp 0.33.x + system libvips). No further code changes are required for this to be final.
- **After deploy:** Run `./tests/test-api.sh` with `BASE_URL` and `SERVICE_API_KEY` to smoke-test the live service.

### 4) Verify

```bash
curl -s https://YOUR_CLOUD_RUN_URL/health
```

Optional full smoke test against the deployed URL:

```bash
BASE_URL=https://YOUR_CLOUD_RUN_URL SERVICE_API_KEY=your-key ./tests/test-api.sh
```

## Consume Securely from Astro on Cloudflare Pages

**Goal:** Keep `SERVICE_API_KEY` off the client and enforce CORS for your Pages domain(s).

### 1) Set Origins in Cloud Run

Set `CORS_ALLOWED_ORIGINS` to your Cloudflare Pages domains:
```
https://your-site.pages.dev,https://your-branch.your-site.pages.dev,https://your-custom-domain.com
```

Common Cloudflare Pages patterns:
- `https://<project>.pages.dev` (production)
- `https://<branch>.<project>.pages.dev` (preview)
- `https://your-custom-domain.com` (custom domain)

Example:
```
https://delman.pages.dev,https://main.delman.pages.dev,https://delman.com
```

### 2) Proxy Requests Server-Side (Astro)

Create an API route in your Astro project that proxies to Cloud Run and injects the API key from environment variables (never expose it to the client).

Example `src/pages/api/media/image.ts`:
```ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const target = new URL('https://YOUR_CLOUD_RUN_URL/v1/image/convert');
  target.search = url.search;

  const res = await fetch(target, {
    method: 'POST',
    headers: {
      'X-Api-Key': import.meta.env.SERVICE_API_KEY,
    },
    body: await request.formData(),
  });

  return new Response(await res.arrayBuffer(), {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
    },
  });
};
```

Example `src/pages/api/media/peaks.ts`:
```ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const target = new URL('https://YOUR_CLOUD_RUN_URL/v1/audio/peaks');
  target.search = url.search;

  const res = await fetch(target, {
    method: 'POST',
    headers: {
      'X-Api-Key': import.meta.env.SERVICE_API_KEY,
    },
    body: await request.formData(),
  });

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 3) Configure Astro Environment Variables

In Cloudflare Pages:
```
SERVICE_API_KEY=your-secret-key
```

If you want to request debug output from the browser, pass `debug=info` (or another level) to your Astro proxy route:
```
POST /api/media/peaks?debug=info
POST /api/media/image?debug=info
```

### 4) Call From Your Frontend

Use your Astro API routes from the browser:

```bash
curl -X POST "https://your-site.pages.dev/api/media/peaks?samples=500" \
  -F "audio=@song.mp3"
```

## Project Structure

```
├── src/
│   ├── index.ts              # Application bootstrap
│   ├── config/
│   │   └── swagger.ts        # OpenAPI configuration
│   ├── middleware/
│   │   ├── index.ts          # Barrel exports
│   │   ├── auth.ts           # API key authentication
│   │   ├── cors.ts           # CORS validation
│   │   ├── errorHandler.ts   # Error handlers
│   │   └── rateLimit.ts      # Rate limiting
│   ├── routes/
│   │   ├── audio.ts          # Audio peaks endpoint
│   │   ├── health.ts         # Health check endpoint
│   │   ├── image.ts          # Image conversion endpoint
│   │   └── odesli.ts         # Odesli (Songlink) music link proxy
│   ├── types/
│   │   └── index.ts          # Type definitions & Zod schemas
│   └── utils/
│       ├── index.ts          # Barrel exports
│       ├── audio.ts          # Audio processing utilities
│       ├── debug.ts          # Debug utilities
│       └── logger.ts         # Pino logger configuration
├── tests/
│   ├── setup.ts              # Test env (NODE_ENV=test, SERVICE_API_KEY, CORS)
│   ├── test-api.sh           # Live API smoke test (deployed service)
│   ├── data/                 # Sample HEIC and audio files for test-api.sh
│   ├── integration/
│   │   ├── api.test.ts       # API integration tests (all endpoints + legacy)
│   │   └── middleware.test.ts # CORS and rate limit tests
│   └── unit/
│       ├── audio.test.ts     # Audio utility tests
│       ├── debug.test.ts     # Debug encoding/parsing tests
│       ├── env.test.ts       # Env validation tests
│       └── types.test.ts     # Zod schema tests
├── dist/                     # Compiled JavaScript (generated)
├── Dockerfile                # Container configuration
├── package.json
├── tsconfig.json
└── vitest.config.ts          # Test configuration
```

## License

ISC
