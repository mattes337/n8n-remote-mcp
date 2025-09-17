const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const EventSource = require('eventsource');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for n8n
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.text());

// Store active MCP process
let mcpProcess = null;
let mcpStdio = { stdin: null, stdout: null, stderr: null };

// Initialize MCP server on startup
function initializeMCPServer() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!accessToken) {
    console.error('SUPABASE_ACCESS_TOKEN not provided');
    process.exit(1);
  }

  console.log('Starting Supabase MCP server...');

  mcpProcess = spawn('npx', [
    '-y',
    '@supabase/mcp-server-supabase@latest',
    '--access-token',
    accessToken
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  mcpStdio.stdin = mcpProcess.stdin;
  mcpStdio.stdout = mcpProcess.stdout;
  mcpStdio.stderr = mcpProcess.stderr;

  mcpProcess.stdout.on('data', (data) => {
    console.log('MCP stdout:', data.toString());
  });

  mcpProcess.stderr.on('data', (data) => {
    console.error('MCP stderr:', data.toString());
  });

  mcpProcess.on('close', (code) => {
    console.log(`MCP process exited with code ${code}`);
    // Restart if it crashes
    if (code !== 0) {
      setTimeout(initializeMCPServer, 5000);
    }
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    mcp_running: mcpProcess !== null && !mcpProcess.killed
  });
});

// Server info endpoint
app.get('/info', (req, res) => {
  res.json({
    name: 'Supabase MCP Server',
    version: '1.0.0',
    protocols: ['jsonrpc'],
    methods: [
      'initialize',
      'list_tools',
      'call_tool'
    ]
  });
});

// JSON-RPC endpoint for MCP communication
app.post('/rpc', async (req, res) => {
  try {
    if (!mcpProcess || mcpProcess.killed) {
      return res.status(503).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'MCP server not running'
        },
        id: req.body.id
      });
    }

    const request = req.body;
    console.log('Received RPC request:', JSON.stringify(request, null, 2));

    // Set up response handling
    const responseHandler = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('MCP response timeout'));
      }, 30000);

      const dataHandler = (data) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          resolve(response);
        } catch (e) {
          // Handle partial responses or multiple responses
          const lines = data.toString().split('\n').filter(line => line.trim());
          for (const line of lines) {
            try {
              const response = JSON.parse(line);
              if (response.id === request.id) {
                resolve(response);
                break;
              }
            } catch (parseError) {
              console.error('Parse error:', parseError);
            }
          }
        }
      };

      mcpStdio.stdout.once('data', dataHandler);
    });

    // Send request to MCP server
    mcpStdio.stdin.write(JSON.stringify(request) + '\n');

    // Wait for response
    const response = await responseHandler;
    res.json(response);

  } catch (error) {
    console.error('RPC error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error.message
      },
      id: req.body.id
    });
  }
});

// Webhook endpoint for n8n (processes request and returns result directly)
app.post('/webhook', async (req, res) => {
  try {
    if (!mcpProcess || mcpProcess.killed) {
      return res.status(503).json({
        error: 'MCP server not running'
      });
    }

    const { method, params } = req.body;
    const requestId = Math.floor(Math.random() * 1000000);

    const request = {
      jsonrpc: '2.0',
      method: method || 'list_tools',
      params: params || {},
      id: requestId
    };

    console.log('Webhook request:', JSON.stringify(request, null, 2));

    // Set up response handling
    const responseHandler = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('MCP response timeout'));
      }, 30000);

      const dataHandler = (data) => {
        clearTimeout(timeout);
        try {
          const lines = data.toString().split('\n').filter(line => line.trim());
          for (const line of lines) {
            try {
              const response = JSON.parse(line);
              if (response.id === requestId) {
                resolve(response);
                break;
              }
            } catch (e) {
              // Continue to next line
            }
          }
        } catch (e) {
          console.error('Parse error:', e);
        }
      };

      mcpStdio.stdout.once('data', dataHandler);
    });

    // Send request to MCP server
    mcpStdio.stdin.write(JSON.stringify(request) + '\n');

    // Wait for response
    const response = await responseHandler;

    // Return only the result for n8n
    if (response.result) {
      res.json(response.result);
    } else if (response.error) {
      res.status(400).json(response.error);
    } else {
      res.json(response);
    }

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

// SSE endpoint for streaming responses
app.get('/stream', (req, res) => {
  console.log('SSE client connected');

  // Set proper SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

  // Send SSE comment to establish connection
  res.write(':ok\n\n');

  // Send heartbeat every 15 seconds to keep connection alive
  const heartbeatInterval = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 15000);

  // Send initial connection message in SSE format
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

  // Handle MCP stdout stream
  const streamHandler = (data) => {
    try {
      const message = data.toString();
      // Send each line of output as a separate SSE event
      const lines = message.split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          // Try to parse as JSON first
          const jsonData = JSON.parse(line);
          res.write(`data: ${JSON.stringify({ type: 'json', content: jsonData, timestamp: Date.now() })}\n\n`);
        } catch {
          // If not JSON, send as plain text
          res.write(`data: ${JSON.stringify({ type: 'text', content: line, timestamp: Date.now() })}\n\n`);
        }
      }
    } catch (error) {
      console.error('Stream error:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message, timestamp: Date.now() })}\n\n`);
    }
  };

  if (mcpStdio.stdout) {
    mcpStdio.stdout.on('data', streamHandler);
  }

  // Clean up on client disconnect
  req.on('close', () => {
    console.log('SSE client disconnected');
    clearInterval(heartbeatInterval);
    if (mcpStdio.stdout) {
      mcpStdio.stdout.removeListener('data', streamHandler);
    }
  });

  // Handle errors
  req.on('error', (err) => {
    console.error('SSE connection error:', err);
    clearInterval(heartbeatInterval);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MCP HTTP wrapper listening on port ${PORT}`);
  initializeMCPServer();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});