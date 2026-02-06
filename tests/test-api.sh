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
require_file "${IMAGE_2}"
require_file "${IMAGE_3}"
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
echo "5) Image batch (zip)"
cat > "${TMP_DIR}/image-manifest.json" <<'EOF'
{
  "outputs": [
    {
      "file": "IMG_5777.HEIC",
      "variants": [
        { "format": "webp", "width": 1200, "height": 900, "fit": "cover" },
        { "format": "avif", "width": 1200, "height": 900, "fit": "cover" },
        { "format": "jpg", "width": 400, "height": 400, "fit": "cover", "name": "thumb_400.jpg" }
      ]
    }
  ]
}
EOF

image_batch_zip="${TMP_DIR}/images.zip"
image_batch_status=$(curl -s -o "${image_batch_zip}" -w "%{http_code}" \
  -H "X-Api-Key: ${SERVICE_API_KEY}" \
  -F "images=@${IMAGE_1}" \
  -F "manifest=@${TMP_DIR}/image-manifest.json" \
  "${BASE_URL}/v1/image/batch?debug=info")
if [[ "${image_batch_status}" != "200" ]]; then
  echo "Image batch failed: ${image_batch_status}" >&2
  [[ -s "${image_batch_zip}" ]] && cat "${image_batch_zip}" | head -c 1000 >&2
  echo "" >&2
  exit 1
fi
python - <<'PY'
import sys, zipfile
zf = zipfile.ZipFile(sys.argv[1])
names = zf.namelist()
assert any(n.endswith("manifest.json") for n in names), "manifest.json missing"
assert any(n.endswith("debug.json") for n in names), "debug.json missing"
assert any(n.endswith(".webp") for n in names), "webp missing"
assert any(n.endswith(".avif") for n in names), "avif missing"
assert any(n.endswith("thumb_400.jpg") for n in names), "thumb missing"
print("OK: image batch zip")
PY "${image_batch_zip}"

echo ""
echo "6) Audio batch (zip)"
cat > "${TMP_DIR}/audio-manifest.json" <<'EOF'
{
  "outputs": [
    {
      "file": "Into dust master - v11 .mp3",
      "variants": [
        { "samplesPerMinute": 120 },
        { "samplesPerMinute": 200, "name": "dense.json" }
      ]
    },
    {
      "file": "Koop Island Blues v20.m4a",
      "variants": [
        { "samplesPerMinute": 120 }
      ]
    }
  ]
}
EOF

audio_batch_zip="${TMP_DIR}/audio.zip"
audio_batch_status=$(curl -s -o "${audio_batch_zip}" -w "%{http_code}" \
  -H "X-Api-Key: ${SERVICE_API_KEY}" \
  -F "audio=@${MP3_1}" \
  -F "audio=@${M4A_1}" \
  -F "manifest=@${TMP_DIR}/audio-manifest.json" \
  "${BASE_URL}/v1/audio/peaks/batch?debug=info")
if [[ "${audio_batch_status}" != "200" ]]; then
  echo "Audio batch failed: ${audio_batch_status}" >&2
  exit 1
fi
python - <<'PY'
import sys, zipfile
zf = zipfile.ZipFile(sys.argv[1])
names = zf.namelist()
assert any(n.endswith("manifest.json") for n in names), "manifest.json missing"
assert any(n.endswith("debug.json") for n in names), "debug.json missing"
assert any(n.endswith(".json") for n in names if "peaks/" in n), "peaks json missing"
print("OK: audio batch zip")
PY "${audio_batch_zip}"

echo ""
echo "All tests passed."
