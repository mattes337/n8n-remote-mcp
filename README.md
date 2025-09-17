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
- **JSON-RPC**: `POST http://localhost:3456/rpc` - Full JSON-RPC interface
- **Webhook**: `POST http://localhost:3456/webhook` - Simplified endpoint for n8n
- **SSE Stream**: `GET http://localhost:3456/stream` - Server-sent events with heartbeat

## n8n Integration

### Using HTTP Request Node
1. Add an HTTP Request node
2. Set URL to: `http://your-server-ip:3456/webhook`
3. Method: POST
4. Body Type: JSON
5. Body:
```json
{
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "n8n",
      "version": "1.0.0"
    }
  }
}
```

### Available Methods
- `initialize` - Initialize the MCP connection
- `list_tools` - List available Supabase tools
- `call_tool` - Execute a specific tool

### Using SSE (for streaming)
The `/stream` endpoint provides Server-Sent Events with:
- Automatic heartbeat to prevent timeout
- JSON response streaming
- Connection status messages

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