# Stage 1: Build audiowaveform from source
FROM node:20-bullseye AS audiowaveform-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    cmake \
    g++ \
    make \
    libmad0-dev \
    libid3tag0-dev \
    libsndfile1-dev \
    libgd-dev \
    libboost-filesystem-dev \
    libboost-program-options-dev \
    libboost-regex-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp
RUN git clone https://github.com/bbc/audiowaveform.git --depth 1 \
    && cd audiowaveform \
    && mkdir build \
    && cd build \
    && cmake -D ENABLE_TESTS=OFF .. \
    && make \
    && make install

# Stage 2: Build Node.js app
FROM node:20-bullseye AS builder

WORKDIR /app

# Build sharp against system libvips with HEIF support.
# Do not set npm_config_build_from_source globally or other native deps may fail.
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
ENV PYTHON=/usr/bin/python3
ENV npm_config_python=/usr/bin/python3

# Install build deps for sharp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python3-distutils \
    python3-setuptools \
    python3-venv \
    python-is-python3 \
    build-essential \
    pkg-config \
    libvips-dev \
    libheif-dev \
    libde265-dev \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy package files
COPY package*.json ./

# Install deps without scripts so sharp does not run its check/build yet.
# Then rebuild sharp only, so it builds against system libvips (HEIF) without
# forcing other native deps to build from source.
RUN npm ci --ignore-scripts \
    && npm rebuild sharp --build-from-source

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove dev dependencies for production copy
RUN npm prune --omit=dev

# Stage 3: Production
FROM node:20-bullseye-slim AS production

WORKDIR /app

# Install runtime dependencies for sharp (HEIC/libvips) and audio processing
# Note: libheif-plugin-libde265 is not in Bullseye; libheif1 depends on libde265-0 for HEIC
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips \
    libheif1 \
    libde265-0 \
    ffmpeg \
    libmad0 \
    libid3tag0 \
    libsndfile1 \
    libgd3 \
    libboost-filesystem1.74.0 \
    libboost-program-options1.74.0 \
    libboost-regex1.74.0 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy audiowaveform binary from builder
COPY --from=audiowaveform-builder /usr/local/bin/audiowaveform /usr/local/bin/audiowaveform

# Set production environment
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Copy production dependencies from builder (already pruned)
COPY --from=builder /app/node_modules ./node_modules

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Cloud Run uses PORT environment variable
ENV PORT=8080
EXPOSE 8080

# Run as non-root user for security
USER node

# Start the service
CMD ["node", "dist/index.js"]
