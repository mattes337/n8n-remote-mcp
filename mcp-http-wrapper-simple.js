const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(bodyParser.json());

// Store MCP process state
let mcpProcess = null;
let isInitialized = false;

// Initialize MCP server
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

  mcpProcess.on('close', (code) => {
    console.log(`MCP process exited with code ${code}`);
    if (code !== 0) {
      setTimeout(initializeMCPServer, 5000);
    }
  });
}

// Simple webhook endpoint for n8n
app.post('/execute', async (req, res) => {
  try {
    if (!mcpProcess || mcpProcess.killed) {
      return res.status(503).json({ error: 'MCP server not running' });
    }

    const { method, params } = req.body;

    // Initialize if needed
    if (!isInitialized && method !== 'initialize') {
      const initRequest = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'n8n', version: '1.0.0' }
        },
        id: 1
      };

      await sendRequest(initRequest);
      isInitialized = true;
    }

    // Execute the actual request
    const request = {
      jsonrpc: '2.0',
      method: method || 'list_tools',
      params: params || {},
      id: Math.floor(Math.random() * 1000000)
    };

    console.log('Executing:', method);
    const response = await sendRequest(request);

    // Return only the result
    if (response.result) {
      res.json(response.result);
    } else if (response.error) {
      res.status(400).json(response.error);
    } else {
      res.json(response);
    }

  } catch (error) {
    console.error('Execution error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to send request to MCP
function sendRequest(request) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout'));
    }, 30000);

    const handler = (data) => {
      clearTimeout(timeout);
      try {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              resolve(response);
              return;
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (e) {
        reject(e);
      }
    };

    mcpProcess.stdout.once('data', handler);
    mcpProcess.stdin.write(JSON.stringify(request) + '\n');
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    mcp_running: mcpProcess !== null && !mcpProcess.killed,
    initialized: isInitialized
  });
});

// List available tools
app.get('/tools', async (req, res) => {
  try {
    if (!isInitialized) {
      const initRequest = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'n8n', version: '1.0.0' }
        },
        id: 1
      };
      await sendRequest(initRequest);
      isInitialized = true;
    }

    const request = {
      jsonrpc: '2.0',
      method: 'list_tools',
      params: {},
      id: Math.floor(Math.random() * 1000000)
    };

    const response = await sendRequest(request);
    res.json(response.result || response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Simplified MCP wrapper listening on port ${PORT}`);
  initializeMCPServer();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  if (mcpProcess) mcpProcess.kill();
  process.exit(0);
});