# Media Processing Microservice

A Node.js Express microservice for image conversion and audio processing, designed to run on Google Cloud Run.

## Features

- Convert images between formats (JPEG, PNG, WebP, AVIF, TIFF, GIF)
- HEIC/HEIF input support
- Resize images with configurable dimensions and fit modes
- Extract audio waveform peaks for visualization
- API key authentication
- Optimized for Cloud Run deployment

## Prerequisites

- Node.js 20+
- npm
- audiowaveform (for audio processing)
- ffmpeg (for audio format support)

### Installing audiowaveform

**macOS:**
```bash
brew install audiowaveform
```

**Ubuntu/Debian:**
```bash
sudo apt-get install audiowaveform
```

**From source:** See [audiowaveform GitHub](https://github.com/bbc/audiowaveform)

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Run Locally

```bash
export SERVICE_API_KEY=your-secret-key
npm start
```

The service starts on port 8080 by default (configurable via `PORT` environment variable).

## API

### Authentication

All endpoints require the `X-Api-Key` header with a valid API key matching the `SERVICE_API_KEY` environment variable.

### Endpoints

#### `GET /health`

Health check endpoint.

**Response:**
```json
{ "status": "ok" }
```

#### `POST /image/convert`

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

**Response:** Binary image data with appropriate `Content-Type` header.

**Example:**
```bash
curl -X POST "http://localhost:8080/image/convert?format=webp&width=800&height=600&fit=cover" \
  -H "X-Api-Key: your-secret-key" \
  -F "image=@input.heic" \
  --output output.webp
```

#### `POST /audio/peaks`

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
| samples | number | 800 | Number of peaks to return (1-10000) |

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
curl -X POST "http://localhost:8080/audio/peaks?samples=500" \
  -H "X-Api-Key: your-secret-key" \
  -F "audio=@song.mp3"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| SERVICE_API_KEY | Yes | API key for authentication |
| PORT | No | Server port (default: 8080) |

## Docker

The project uses a multi-stage Dockerfile for optimized production builds:

- **Stage 1 (builder):** Compiles TypeScript using `node:20-bookworm`
- **Stage 2 (production):** Minimal runtime image with `node:20-bookworm-slim`

Build locally:
```bash
docker build -t media-service .
docker run -p 8080:8080 -e SERVICE_API_KEY=your-secret-key media-service
```

## Deploy to Google Cloud Run

### Automated Deployment (GitHub Actions)

The repository includes a GitHub Actions workflow that automatically deploys to Cloud Run on pushes to `main`.

**Required GitHub Secrets:**

| Secret | Description |
|--------|-------------|
| `GCP_PROJECT_ID` | Your Google Cloud project ID |
| `GCP_SA_KEY` | Service Account JSON key with Cloud Run and Artifact Registry permissions |
| `SERVICE_API_KEY` | API key for the service authentication |

**Required GCP Setup:**

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

### Manual Deployment

1. Build and push the container:
```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/media-service
```

2. Deploy to Cloud Run:
```bash
gcloud run deploy media-service \
  --image gcr.io/YOUR_PROJECT_ID/media-service \
  --set-env-vars SERVICE_API_KEY=your-secret-key \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --max-instances 5
```

## Project Structure

```
├── src/
│   └── index.ts       # Main application
├── dist/              # Compiled JavaScript (generated)
├── Dockerfile         # Container configuration
├── package.json
└── tsconfig.json
```
