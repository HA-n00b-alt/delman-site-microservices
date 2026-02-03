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
    && cmake .. \
    && make \
    && make install

# Stage 2: Build Node.js app
FROM node:20-bullseye AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Stage 3: Production
FROM node:20-bullseye-slim AS production

WORKDIR /app

# Install runtime dependencies for sharp (HEIC/libvips) and audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips \
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

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Cloud Run uses PORT environment variable
ENV PORT=8080
EXPOSE 8080

# Run as non-root user for security
USER node

# Start the service
CMD ["node", "dist/index.js"]
