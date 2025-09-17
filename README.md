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

The server now includes two modes:
- **Simple mode** (default): Optimized for n8n with straightforward endpoints
- **Full mode**: Complete SSE support for advanced use cases

### Using Simple Mode (Recommended for n8n)

#### Execute MCP Commands
1. Add an HTTP Request node
2. Set URL to: `http://your-server-ip:3456/execute`
3. Method: POST
4. Body Type: JSON
5. Body:
```json
{
  "method": "call_tool",
  "params": {
    "name": "sql_query",
    "arguments": {
      "query": "SELECT * FROM users LIMIT 10"
    }
  }
}
```

#### Simple Mode Endpoints
- `POST /execute` - Execute any MCP method (auto-initializes)
- `GET /tools` - List all available Supabase tools
- `GET /health` - Check server status

### Available Methods
- `list_tools` - List available Supabase tools
- `call_tool` - Execute a specific tool (see example above)

### Switching Modes
To use full SSE mode, change `WRAPPER_MODE` in docker-compose.yml:
```yaml
environment:
  - WRAPPER_MODE=full  # Enable SSE support
```

Full mode endpoints:
- `/webhook` - Simplified POST endpoint
- `/stream` - Server-Sent Events with heartbeat
- `/rpc` - Full JSON-RPC interface

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