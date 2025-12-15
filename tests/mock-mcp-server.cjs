#!/usr/bin/env node
/**
 * Mock MCP Server for Testing
 * 
 * This is a simple MCP server that implements the basic protocol
 * for testing the MCP client implementation.
 * 
 * It provides two test tools:
 * - echo: Returns the input message
 * - add: Adds two numbers
 */

const readline = require('readline');

// Server capabilities and info
const SERVER_INFO = {
  name: 'mock-mcp-server',
  version: '1.0.0',
};

const CAPABILITIES = {
  tools: {},
};

// Available tools
const TOOLS = [
  {
    name: 'echo',
    description: 'Echoes back the input message',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to echo back',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'add',
    description: 'Adds two numbers together',
    inputSchema: {
      type: 'object',
      properties: {
        a: {
          type: 'number',
          description: 'First number',
        },
        b: {
          type: 'number',
          description: 'Second number',
        },
      },
      required: ['a', 'b'],
    },
  },
  {
    name: 'greet',
    description: 'Generates a greeting message',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name to greet',
        },
        formal: {
          type: 'boolean',
          description: 'Use formal greeting',
          default: false,
        },
      },
      required: ['name'],
    },
  },
];

// Tool execution handlers
const TOOL_HANDLERS = {
  echo: (args) => {
    return { text: args.message };
  },
  add: (args) => {
    const result = args.a + args.b;
    return { text: `${args.a} + ${args.b} = ${result}` };
  },
  greet: (args) => {
    const greeting = args.formal
      ? `Good day, ${args.name}. It is a pleasure to meet you.`
      : `Hello, ${args.name}!`;
    return { text: greeting };
  },
};

// JSON-RPC message handling
let messageId = 0;

function createResponse(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function createError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  };
}

function handleRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return createResponse(id, {
        protocolVersion: '2024-11-05',
        serverInfo: SERVER_INFO,
        capabilities: CAPABILITIES,
      });

    case 'initialized':
      // This is a notification, no response needed
      return null;

    case 'tools/list':
      return createResponse(id, {
        tools: TOOLS,
      });

    case 'tools/call':
      const { name, arguments: args } = params;
      const handler = TOOL_HANDLERS[name];
      
      if (!handler) {
        return createError(id, -32601, `Tool not found: ${name}`);
      }

      try {
        const result = handler(args || {});
        return createResponse(id, {
          content: [
            {
              type: 'text',
              text: typeof result.text === 'string' ? result.text : JSON.stringify(result),
            },
          ],
          isError: false,
        });
      } catch (err) {
        return createResponse(id, {
          content: [
            {
              type: 'text',
              text: `Error: ${err.message}`,
            },
          ],
          isError: true,
        });
      }

    case 'ping':
      return createResponse(id, {});

    default:
      return createError(id, -32601, `Method not found: ${method}`);
  }
}

// Set up stdio communication
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  
  // Try to parse complete JSON-RPC messages
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    
    if (line.trim()) {
      try {
        const request = JSON.parse(line);
        const response = handleRequest(request);
        
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (err) {
        // Log parsing errors to stderr
        process.stderr.write(`Parse error: ${err.message}\n`);
        
        // Send error response
        const errorResponse = createError(null, -32700, 'Parse error');
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

// Handle errors
process.on('uncaughtException', (err) => {
  process.stderr.write(`Uncaught exception: ${err.message}\n`);
  process.exit(1);
});

// Log startup to stderr (not stdout, which is for MCP protocol)
process.stderr.write('Mock MCP Server started\n');