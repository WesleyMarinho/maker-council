/**
 * OpenAI-compatible API server for MAKER-Council
 * Exposes the /v1/chat/completions endpoint using MAKER-Council logic
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  handleQuery,
  QueryRequest,
  QueryResponse,
  initializeMcpClient,
  getMcpToolManager,
  Intent,
  QueryContext,
  QueryConfig,
  initializeLogic
} from './logic.js';
import { tools } from './tools.js';
import { config } from './config.js';

// The port is now obtained directly from the configuration object
const PORT = config.port;
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '500mb' }));
app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));

// Interface for OpenAI Chat Completions request
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: any;
}

interface OpenAIRequest {
  model?: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  user?: string;
  // MAKER-Council custom parameters
  maker_intent?: 'decision' | 'code_review' | 'decomposition' | 'validation';
  maker_num_voters?: number;
  maker_k?: number;
}

// Interface for OpenAI Chat Completions response
interface OpenAIChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: 'stop' | 'length' | 'function_call' | 'content_filter';
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

// Helper to generate OpenAI-style unique ID
function generateOpenAIId(): string {
  return `chatcmpl-${Date.now()}`;
}

// Extracts the last user message from the messages array
function extractLastUserMessage(messages: OpenAIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const content = messages[i].content;

      if (typeof content === 'string') {
        return content;
      }

      if (Array.isArray(content)) {
        // Extract text from 'text' type parts
        return content
          .filter((part: any) => part?.type === 'text' && part?.text)
          .map((part: any) => part.text)
          .join('\n');
      }

      // Null or undefined content (use empty string as fallback)
      return '';
    }
  }
  throw new Error('No user message found');
}

// Helper function to send SSE chunks
function sendSSEChunk(res: express.Response, data: any): void {
  const chunk = `data: ${JSON.stringify(data)}\n\n`;
  res.write(chunk);
}

// Function to break text into word chunks
// Function to break text into word chunks
function* chunkByWords(text: string, chunkSize: number = 5): Generator<string> {
  const words = text.split(' ');
  for (let i = 0; i < words.length; i += chunkSize) {
    yield words.slice(i, i + chunkSize).join(' ');
  }
}

// MCP Server Initialization
const server = new Server(
  {
    name: "maker-council",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "query": {
        const queryRequest: QueryRequest = {
          prompt: args?.prompt as string,
          context: args?.context as QueryContext | undefined,
          intent: args?.intent as Intent | undefined,
          config: args?.config as QueryConfig | undefined,
        };
        const response = await handleQuery(queryRequest);
        result = JSON.stringify(response, null, 2);
        break;
      }

      case "consult_council": {
        const queryRequest: QueryRequest = {
          prompt: args?.query as string,
          intent: 'decision',
          config: {
            num_voters: args?.num_voters as number | undefined,
            k: args?.k as number | undefined,
          },
        };
        const response = await handleQuery(queryRequest);
        result = JSON.stringify(response, null, 2);
        break;
      }

      case "solve_with_voting": {
        const queryRequest: QueryRequest = {
          prompt: args?.query as string,
          intent: 'validation',
          config: {
            k: args?.k as number | undefined,
          },
        };
        const response = await handleQuery(queryRequest);
        result = JSON.stringify(response, null, 2);
        break;
      }

      case "decompose_task": {
        const queryRequest: QueryRequest = {
          prompt: args?.task as string,
          intent: 'decomposition',
        };
        const response = await handleQuery(queryRequest);
        result = JSON.stringify(response, null, 2);
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});


// MCP SSE Transport logic
let transport: SSEServerTransport | null = null;

app.get('/sse', async (req, res) => {
  console.log('[MCP] New SSE connection');
  transport = new SSEServerTransport('/message', res);
  await server.connect(transport);

  // Keep connection alive
  res.on('close', () => {
    console.log('[MCP] SSE connection closed');
    transport = null;
  });
});

app.post('/message', async (req, res) => {
  if (!transport) {
    res.status(400).send('No active SSE connection');
    return;
  }
  await transport.handlePostMessage(req, res);
});

// Main endpoint - Chat Completions
app.post('/v1/chat/completions', async (req, res) => {
  try {
    console.log('\n[DEBUG] ========== NEW REQUEST ==========');
    console.log('[DEBUG] Request body:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] Messages array:', JSON.stringify(req.body.messages, null, 2));
    console.log('[DEBUG] Stream mode:', req.body.stream);

    // Validate request
    const openaiReq: OpenAIRequest = req.body;

    if (!openaiReq.messages || !Array.isArray(openaiReq.messages)) {
      console.log('[DEBUG] ERROR: messages is not a valid array');
      return res.status(400).json({
        error: {
          message: 'The "messages" field is required and must be an array',
          type: 'invalid_request_error',
          param: 'messages'
        }
      });
    }

    // Extract last user message
    const userMessage = extractLastUserMessage(openaiReq.messages);
    console.log('[DEBUG] Extracted userMessage:', userMessage);
    console.log('[DEBUG] userMessage length:', userMessage.length);

    // Build request for MAKER-Council
    const queryRequest: QueryRequest = {
      prompt: userMessage,
      intent: openaiReq.maker_intent,
      config: {
        num_voters: openaiReq.maker_num_voters,
        k: openaiReq.maker_k
      }
    };
    console.log('[DEBUG] QueryRequest constructed:', JSON.stringify(queryRequest, null, 2));

    // Add context if there are previous messages
    if (openaiReq.messages.length > 1) {
      queryRequest.context = {
        history: openaiReq.messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      };
      console.log('[DEBUG] Context added with', openaiReq.messages.length, 'messages');
    }

    // Process with MAKER-Council using the imported configuration object
    console.log('[DEBUG] Calling handleQuery...');
    const response: QueryResponse = await handleQuery(queryRequest);
    console.log('[DEBUG] Response from handleQuery:', JSON.stringify(response, null, 2).substring(0, 500) + '...');

    // Check if the client requested streaming
    if (openaiReq.stream === true) {
      console.log('[DEBUG] STREAMING mode enabled');
      // Configure headers for Server-Sent Events (SSE)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const id = generateOpenAIId();
      const created = Math.floor(Date.now() / 1000);
      const model = openaiReq.model || 'maker-council-v1';

      // Get the response content as a string
      const content = typeof response.result === 'string'
        ? response.result
        : JSON.stringify(response.result, null, 2);

      console.log('[DEBUG] Content for streaming (first 200 chars):', content.substring(0, 200));
      console.log('[DEBUG] Total content length:', content.length);

      // Send initial chunk with role
      console.log('[DEBUG] Sending initial chunk...');
      sendSSEChunk(res, {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null
        }]
      });

      // Send content in word chunks
      for (const chunk of chunkByWords(content, 3)) {
        sendSSEChunk(res, {
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{
            index: 0,
            delta: { content: chunk + ' ' },
            finish_reason: null
          }]
        });

        // Small delay to simulate real streaming
        await new Promise(resolve => setTimeout(resolve, 30));
      }

      // Send final chunk with finish_reason
      console.log('[DEBUG] Sending final chunk...');
      sendSSEChunk(res, {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop'
        }]
      });

      // Send the [DONE] marker
      console.log('[DEBUG] Sending [DONE]...');
      res.write('data: [DONE]\n\n');
      res.end();
      console.log('[DEBUG] Streaming finished successfully');

    } else {
      console.log('[DEBUG] NON-STREAMING mode');
      // Non-streaming response (original logic)
      const openaiResponse: OpenAIResponse = {
        id: generateOpenAIId(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: openaiReq.model || 'maker-council-v1',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: typeof response.result === 'string'
              ? response.result
              : JSON.stringify(response.result, null, 2)
          },
          finish_reason: 'stop'
        }]
      };

      // Add usage information (estimated)
      const promptTokens = Math.ceil(
        openaiReq.messages.reduce((sum, msg) => {
          if (typeof msg.content === 'string') return sum + msg.content.length;
          if (Array.isArray(msg.content)) return sum + JSON.stringify(msg.content).length;
          return sum;
        }, 0) / 4
      );
      const completionTokens = Math.ceil(
        (typeof response.result === 'string' ? response.result : JSON.stringify(response.result)).length / 4
      );

      openaiResponse.usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      };

      // Add specific OpenAI headers
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');

      res.json(openaiResponse);
    }

  } catch (error) {
    console.error('[Server] Error in /v1/chat/completions endpoint:', error);

    // If in streaming mode, send error via SSE
    if (req.body?.stream === true && !res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      sendSSEChunk(res, {
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          type: 'server_error',
          code: 'internal_error'
        }
      });
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // Return error in OpenAI format
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          type: 'server_error',
          code: 'internal_error'
        }
      });
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Endpoint to list available models (OpenAI compatibility)
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: 'maker-council-v1',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'maker-council'
      }
    ]
  });
});

// Middleware for not-found routes
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      type: 'invalid_request_error',
      code: 'not_found'
    }
  });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({
    error: {
      message: 'Internal server error',
      type: 'server_error',
      code: 'internal_error'
    }
  });
});

// Start server
async function startServer() {
  await initializeLogic();

  app.listen(PORT, () => {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 MAKER-Council API Server');
    console.log('='.repeat(70));

    console.log('\n📍 Endpoints:');
    console.log(`   - Chat Completions: http://localhost:${PORT}/v1/chat/completions`);
    console.log(`   - Health Check:     http://localhost:${PORT}/health`);
    console.log(`   - Models List:      http://localhost:${PORT}/v1/models`);

    console.log('\n⚙️  LLM Provider Configuration:');
    console.log(`   - API URL:          ${config.apiUrl}`);
    console.log(`   - API Key:          ${config.apiKey ? '***' + config.apiKey.slice(-4) : '(not set)'}`);
    console.log(`   - Default Model:    ${config.judgeModel}`);

    console.log('\n🗳️  MAKER-Council Settings:');
    console.log(`   - Judge Model:      ${config.judgeModel}`);
    console.log(`   - Voter Model:      ${config.voterModel}`);
    console.log(`   - K (voting margin): ${config.k}`);
    console.log(`   - Max Rounds:       ${config.maxRounds}`);
    console.log(`   - Max Tokens:       ${config.maxTokens}`);

    console.log('\n⚡ Performance Settings:');
    console.log(`   - Fast Mode:        ${config.fastMode ? 'ENABLED' : 'DISABLED'}`);
    console.log(`   - Simple Prompt Max: ${config.simplePromptMaxLength} chars`);
    console.log(`   - Include Report:   ${config.includeReport ? 'YES' : 'NO'}`);

    console.log('\n🔌 MCP Client Configuration:');
    console.log(`   - Enabled:          ${config.mcpClient.enabled ? 'YES' : 'NO'}`);
    console.log(`   - Servers:          ${config.mcpClient.servers.length} configured`);
    if (config.mcpClient.servers.length > 0) {
      config.mcpClient.servers.forEach(s => {
        console.log(`     • ${s.name}: ${s.command} ${s.args.join(' ')}`);
      });
    }
    console.log(`   - Default Timeout:  ${config.mcpClient.defaultTimeout}ms`);
    console.log(`   - Max Iterations:   ${config.mcpClient.maxAgentIterations}`);

    // Basic infinite loop prevention
    // Checks if the API URL points to localhost with the same port as this server
    try {
      const url = new URL(config.apiUrl);
      const isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname);
      const isSamePort = url.port === String(PORT) || (url.port === '' && PORT === 80);

      if (isLocalhost && isSamePort) {
        console.log('\n' + '!'.repeat(70));
        console.error('❌ CRITICAL ERROR: LLM Provider URL points to this server!');
        console.error('   This would cause an infinite loop.');
        console.error('   Please change MAKER_BASE_URL in your .env file.');
        console.error('   It must point to an external provider or a different port.');
        console.log('!'.repeat(70));
        process.exit(1);
      }
    } catch (e) {
      // Ignore URL parsing errors, let the request fail naturally later
    }

    console.log('\n' + '-'.repeat(70));
    console.log('💡 Test with curl:');
    console.log(`curl -X POST http://localhost:${PORT}/v1/chat/completions \\`);
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"messages": [{"role": "user", "content": "Hello!"}]}\'');
    console.log('-'.repeat(70) + '\n');
  });
}

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down server...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, shutting down server...');
  process.exit(0);
});