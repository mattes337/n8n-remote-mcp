# n8n Remote MCP Server - Supabase

Docker container for running Supabase MCP server with HTTP/SSE endpoints for n8n integration.

## Features

- Supabase MCP server wrapped in HTTP/SSE interface
- JSON-RPC endpoint for synchronous requests
- Server-Sent Events (SSE) for streaming responses
- Health monitoring and automatic restart
- CORS enabled for cross-origin requests

## Setup

1. Clone the repository:
```bash
git clone https://github.com/mattes337/n8n-remote-mcp.git
cd n8n-remote-mcp
```

2. Configure your Supabase access token in `.env`:
```bash
SUPABASE_ACCESS_TOKEN=your_token_here
```

3. Build and run with Docker Compose:
```bash
docker-compose up -d
```

## Endpoints

- **Health Check**: `GET http://localhost:3456/health`
- **Server Info**: `GET http://localhost:3456/info`
- **JSON-RPC**: `POST http://localhost:3456/rpc`
- **SSE Stream**: `GET http://localhost:3456/stream`

## n8n Integration

Connect to the MCP server from n8n using:
- Base URL: `http://your-server-ip:3456`
- Use the `/rpc` endpoint for JSON-RPC requests
- Use the `/stream` endpoint for SSE streaming

## Docker Commands

```bash
# Start the service
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the service
docker-compose down

# Rebuild after changes
docker-compose build
docker-compose up -d
```

## Environment Variables

- `SUPABASE_ACCESS_TOKEN`: Your Supabase service role key (required)
- `PORT`: HTTP server port (default: 3000, mapped to 3456 externally)

## License

MIT