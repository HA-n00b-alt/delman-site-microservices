# Stage 1: Build audiowaveform from source
FROM node:trixie AS audiowaveform-builder

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

# Stage 2: Build Node.js app (Trixie has libvips 8.18+ and libheif with HEVC plugin)
FROM node:trixie AS builder

WORKDIR /app

# Build sharp against system libvips with HEIF/HEVC (required for HEIC from iPhones).
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
ENV PYTHON=/usr/bin/python3
ENV npm_config_python=/usr/bin/python3

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    build-essential \
    pkg-config \
    libvips-dev \
    libheif-dev \
    libde265-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

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
FROM node:trixie-slim AS production

WORKDIR /app

# Runtime deps: sharp uses system libvips (HEIF/HEVC via libheif+libde265), plus audio.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips \
    libheif1 \
    libheif-plugin-libde265 \
    libde265-0 \
    ffmpeg \
    libmad0 \
    libid3tag0 \
    libsndfile1 \
    libgd3 \
    libboost-filesystem1.83.0 \
    libboost-program-options1.83.0 \
    libboost-regex1.83.0 \
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
