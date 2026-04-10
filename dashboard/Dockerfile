FROM node:22-slim

# Docker CLI is opt-in. Build with --build-arg INSTALL_DOCKER_CLI=true only in
# trusted dev/CI environments where Docker socket access is explicitly required.
ARG INSTALL_DOCKER_CLI=false
RUN if [ "$INSTALL_DOCKER_CLI" = "true" ]; then \
      apt-get update \
      && (apt-get install -y --no-install-recommends docker.io docker-compose-plugin ca-certificates \
          || apt-get install -y --no-install-recommends docker.io docker-compose ca-certificates) \
      && rm -rf /var/lib/apt/lists/*; \
    fi

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install all dependencies (including dev for Vite build)
RUN npm install

# Copy application files
COPY server.js ./
COPY persistence.js ./
COPY tracing.js ./
COPY src ./src
COPY index.html vite.config.js ./
COPY tests ./tests

# Build frontend with Vite
RUN npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => { r.resume(); r.on('end', () => process.exit(r.statusCode === 200 ? 0 : 1)); }).on('error', () => process.exit(1))"

# Start server
CMD ["node", "server.js"]
