# Stage 1: Build Frontend
FROM oven/bun:1 AS frontend-builder

WORKDIR /app

# Copy frontend config
# We preserve the directory structure to avoid confusion
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/bun.lock ./

# Install frontend dependencies
RUN bun install --frozen-lockfile

# Copy frontend source
COPY apps/web ./

# Build frontend
RUN bun run build


# Stage 2: Runtime (Backend)
FROM oven/bun:1-debian

# Install Python 3 and virtualenv for SandboxPlugin
# oven/bun:1-debian is based on Debian (likely Bookworm or similar)
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root dependencies
COPY package.json bun.lock ./

# Install backend dependencies (production only)
RUN bun install --production --frozen-lockfile

# Copy Backend Source Code
COPY src ./src
COPY mcp ./mcp
COPY skills ./skills
COPY tsconfig.json ./

# Copy Built Frontend Assets
# We place them in 'public' which ServerPlugin is configured to serve
COPY --from=frontend-builder /app/apps/web/dist ./public

# Setup directories required by the application
RUN mkdir -p workspace deliverables kairo_python_env

# Environment Configuration
ENV NODE_ENV=production
ENV PORT=3000
# Override the python env path to point to the one inside the container
ENV PYTHON_ENV_PATH=/app/kairo_python_env

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["bun", "src/index.ts"]
