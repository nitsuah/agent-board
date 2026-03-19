FROM node:22-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application files
COPY server.js ./
COPY src ./src
COPY index.html vite.config.js ./

# Build frontend (if vite is in dev dependencies, we need to include it)
# For production, we'll serve the already-built dist or build on startup
RUN npm install -D vite @vitejs/plugin-react && npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start server
CMD ["node", "server.js"]
