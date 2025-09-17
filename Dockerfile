FROM node:20-slim

WORKDIR /app

# Install dependencies for the MCP server and HTTP wrapper
RUN npm init -y && \
    npm install express cors body-parser eventsource

# Copy both wrapper versions
COPY mcp-http-wrapper.js .
COPY mcp-http-wrapper-simple.js .
COPY .env .env

# Expose port for HTTP/SSE access
EXPOSE 3000

# Use environment variable to choose wrapper (default to simple)
ENV WRAPPER_MODE=simple

# Start the appropriate wrapper service
CMD if [ "$WRAPPER_MODE" = "simple" ]; then \
      node mcp-http-wrapper-simple.js; \
    else \
      node mcp-http-wrapper.js; \
    fi