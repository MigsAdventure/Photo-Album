FROM node:18-alpine

# Install system dependencies for performance
RUN apk add --no-cache \
    ca-certificates \
    curl \
    wget \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create temp directory with proper permissions
RUN mkdir -p /tmp && chmod 777 /tmp

# Set environment variables for performance
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=3072"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Container is healthy')" || exit 1

# Run as non-root user for security
USER node

# Start the processor
CMD ["npm", "start"]
