# Stage 1: Builder
FROM node:24-slim AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install ALL dependencies (including devDependencies)
# Using frozen-lockfile to ensure reproducible builds from pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Copy source code and config files
COPY . .

# Build the application
RUN pnpm run build

# Stage 2: Runner
FROM oven/bun:1-slim AS runner

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install ONLY production dependencies with Bun
RUN bun install --production

# Copy the built files from the builder stage
COPY --from=builder /app/dist ./dist

# Set environment
ENV NODE_ENV=production

# Start the application with Bun
CMD ["bun", "dist/index.js"]
