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
FROM node:24-slim AS runner

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install ONLY production dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy the built files from the builder stage
COPY --from=builder /app/dist ./dist

# Copy any other required runtime files (like faq.json if needed)
# COPY --from=builder /app/faq.json ./faq.json

# Set environment
ENV NODE_ENV=production

# Start the application
CMD ["pnpm", "run", "start"]
