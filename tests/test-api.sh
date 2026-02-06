#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${ROOT_DIR}/tests/data"
ENV_FILE="${ROOT_DIR}/.env"

BASE_URL="${BASE_URL:-https://media-service-129125380439.europe-west3.run.app}"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

if [[ -z "${SERVICE_API_KEY:-}" ]]; then
  echo "Missing SERVICE_API_KEY. Set it in .env or export it." >&2
  exit 1
fi

IMAGE_1="${IMAGE_1:-${DATA_DIR}/IMG_5777.HEIC}"
IMAGE_2="${IMAGE_2:-${DATA_DIR}/IMG_5778.HEIC}"
IMAGE_3="${IMAGE_3:-${DATA_DIR}/IMG_5779.HEIC}"
MP3_1="${MP3_1:-${DATA_DIR}/Into dust master - v11 .mp3}"
M4A_1="${M4A_1:-${DATA_DIR}/Koop Island Blues v20.m4a}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

require_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "Missing file: $file" >&2
    exit 1
  fi
}

require_file "${IMAGE_1}"
require_file "${MP3_1}"
require_file "${M4A_1}"

echo "Base URL: ${BASE_URL}"
echo "Temp dir: ${TMP_DIR}"

echo ""
echo "1) Unauthenticated request should fail"
unauth_status=$(curl -s -o /dev/null -w "%{http_code}" \
  -F "image=@${IMAGE_1}" \
  "${BASE_URL}/v1/image/convert?format=webp")
if [[ "${unauth_status}" != "401" ]]; then
  echo "Expected 401, got ${unauth_status}" >&2
  exit 1
fi
echo "OK: unauthenticated request rejected (401)"

echo ""
echo "2) Health check (no auth)"
health_status=$(curl -s -o "${TMP_DIR}/health.json" -w "%{http_code}" \
  "${BASE_URL}/health")
if [[ "${health_status}" != "200" && "${health_status}" != "503" ]]; then
  echo "Unexpected health status: ${health_status}" >&2
  cat "${TMP_DIR}/health.json"
  exit 1
fi
echo "OK: health status ${health_status}"

echo ""
echo "3) Image convert (single, debug headers)"
image_out="${TMP_DIR}/image.webp"
image_headers="${TMP_DIR}/image.headers"
image_status=$(curl -s -D "${image_headers}" -o "${image_out}" -w "%{http_code}" \
  -H "X-Api-Key: ${SERVICE_API_KEY}" \
  -F "image=@${IMAGE_1}" \
  "${BASE_URL}/v1/image/convert?format=webp&width=800&height=600&fit=cover&debug=info")
if [[ "${image_status}" != "200" ]]; then
  echo "Image convert failed: ${image_status}" >&2
  exit 1
fi
grep -qi "X-Debug-Info:" "${image_headers}" || { echo "Missing X-Debug-Info header"; exit 1; }
echo "OK: image convert"

echo ""
echo "4) Audio peaks (samplesPerMinute)"
audio_status=$(curl -s -o "${TMP_DIR}/peaks.json" -w "%{http_code}" \
  -H "X-Api-Key: ${SERVICE_API_KEY}" \
  -F "audio=@${MP3_1}" \
  "${BASE_URL}/v1/audio/peaks?samplesPerMinute=120&debug=info")
if [[ "${audio_status}" != "200" ]]; then
  echo "Audio peaks failed: ${audio_status}" >&2
  cat "${TMP_DIR}/peaks.json"
  exit 1
fi
echo "OK: audio peaks"

echo ""
echo "All tests passed."
