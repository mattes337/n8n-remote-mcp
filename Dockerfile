FROM node:20-slim

WORKDIR /app

# Install dependencies for the MCP server and HTTP wrapper
RUN npm init -y && \
    npm install express cors body-parser eventsource

# Copy the MCP HTTP wrapper service
COPY mcp-http-wrapper.js .
COPY .env .env

# Expose port for HTTP/SSE access
EXPOSE 3000

# Start the HTTP wrapper service
CMD ["node", "mcp-http-wrapper.js"]