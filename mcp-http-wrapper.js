const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const EventSource = require('eventsource');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to log all requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  next();
});

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
  console.log('====== SSE CLIENT CONNECTED ======');
  console.log('Request headers:', JSON.stringify(req.headers, null, 2));
  console.log('Client IP:', req.ip);
  console.log('User Agent:', req.get('user-agent'));

  // Log connection state
  let connectionActive = true;
  let heartbeatCount = 0;
  let dataWritten = 0;

  // Set proper SSE headers
  console.log('Setting SSE headers...');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

  console.log('Headers set, response status:', res.statusCode);

  // Send SSE comment to establish connection
  console.log('Writing initial :ok comment...');
  res.write(':ok\n\n');
  dataWritten++;
  console.log(`Data written ${dataWritten}: :ok`);

  // Send heartbeat every 15 seconds to keep connection alive
  const heartbeatInterval = setInterval(() => {
    if (connectionActive) {
      heartbeatCount++;
      console.log(`Sending heartbeat #${heartbeatCount}...`);
      try {
        res.write(':heartbeat\n\n');
        dataWritten++;
        console.log(`Data written ${dataWritten}: heartbeat #${heartbeatCount}`);
      } catch (err) {
        console.error('Error writing heartbeat:', err);
        connectionActive = false;
      }
    }
  }, 15000);

  // Send initial connection message in SSE format
  console.log('Writing initial connection message...');
  const connectMsg = JSON.stringify({ type: 'connected', timestamp: Date.now() });
  try {
    res.write(`data: ${connectMsg}\n\n`);
    dataWritten++;
    console.log(`Data written ${dataWritten}: ${connectMsg}`);
  } catch (err) {
    console.error('Error writing connection message:', err);
  }

  // Handle MCP stdout stream
  const streamHandler = (data) => {
    console.log('=== MCP STDOUT DATA RECEIVED ===');
    console.log('Raw data:', data.toString());

    try {
      const message = data.toString();
      // Send each line of output as a separate SSE event
      const lines = message.split('\n').filter(line => line.trim());
      console.log(`Processing ${lines.length} lines...`);

      for (const line of lines) {
        console.log(`Processing line: "${line}"`);
        try {
          // Try to parse as JSON first
          const jsonData = JSON.parse(line);
          const jsonMsg = JSON.stringify({ type: 'json', content: jsonData, timestamp: Date.now() });
          console.log(`Sending JSON SSE: ${jsonMsg}`);
          res.write(`data: ${jsonMsg}\n\n`);
          dataWritten++;
          console.log(`Data written ${dataWritten}: JSON message`);
        } catch {
          // If not JSON, send as plain text
          const textMsg = JSON.stringify({ type: 'text', content: line, timestamp: Date.now() });
          console.log(`Sending text SSE: ${textMsg}`);
          res.write(`data: ${textMsg}\n\n`);
          dataWritten++;
          console.log(`Data written ${dataWritten}: text message`);
        }
      }
    } catch (error) {
      console.error('Stream handler error:', error);
      const errorMsg = JSON.stringify({ type: 'error', message: error.message, timestamp: Date.now() });
      res.write(`data: ${errorMsg}\n\n`);
      dataWritten++;
      console.log(`Data written ${dataWritten}: error message`);
    }
  };

  console.log('Checking mcpStdio.stdout...');
  if (mcpStdio.stdout) {
    console.log('mcpStdio.stdout exists, attaching stream handler...');
    mcpStdio.stdout.on('data', streamHandler);
    console.log('Stream handler attached');
  } else {
    console.error('WARNING: mcpStdio.stdout is null or undefined!');
  }

  // Log response state periodically
  const stateInterval = setInterval(() => {
    if (connectionActive) {
      console.log(`[SSE State] Connection active, data written: ${dataWritten}, heartbeats: ${heartbeatCount}`);
    }
  }, 30000);

  // Clean up on client disconnect
  req.on('close', () => {
    console.log('====== SSE CLIENT DISCONNECTED ======');
    console.log(`Total data written: ${dataWritten}`);
    console.log(`Total heartbeats sent: ${heartbeatCount}`);
    connectionActive = false;
    clearInterval(heartbeatInterval);
    clearInterval(stateInterval);
    if (mcpStdio.stdout) {
      mcpStdio.stdout.removeListener('data', streamHandler);
      console.log('Stream handler removed');
    }
  });

  // Handle errors
  req.on('error', (err) => {
    console.error('====== SSE CONNECTION ERROR ======');
    console.error('Error details:', err);
    connectionActive = false;
    clearInterval(heartbeatInterval);
    clearInterval(stateInterval);
  });

  console.log('SSE endpoint setup complete');
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