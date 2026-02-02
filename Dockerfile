# Stage 1: Build
FROM node:20-bookworm AS builder

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

# Stage 2: Production
FROM node:20-bookworm-slim AS production

WORKDIR /app

# Install runtime dependencies for sharp (HEIC/libvips) and audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips \
    ffmpeg \
    audiowaveform \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

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
