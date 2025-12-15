#!/usr/bin/env node
/**
 * MAKER-Council MCP Server
 *
 * Implementation of the paper "MAKER: Massively Decomposed Agentic Processes"
 * (arXiv:2511.09030v1)
 *
 * MAKER = Maximal Agentic decomposition + first-to-ahead-by-K Error correction + Red-flagging
 *
 * Main components:
 * 1. MAD (Maximal Agentic Decomposition) - Decomposition into minimal subtasks
 * 2. First-to-ahead-by-k Voting - Voting system with k margin
 * 3. Red-flagging - Automatic discard of problematic responses
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Import MAKER-Council logic and configuration
import {
  handleQuery,
  type MakerConfig,
  type QueryRequest,
  type QueryResponse,
  type Intent,
  type ToolUsed,
  type QueryContext,
  type QueryConfig
} from './logic.js';
import { config } from './config.js';

// ============================================================================
// MCP TOOLS
// ============================================================================

const tools: Tool[] = [
  {
    name: "query",
    description: `Unified MAKER-Council API. Single entry point that automatically routes
to the appropriate tool based on intent or prompt analysis.

This is the RECOMMENDED way to interact with MAKER-Council.

Parameters:
- prompt: The main query (required)
- context: Object with additional context (code, history, filePath)
- intent: Explicit intent ('decision', 'code_review', 'decomposition', 'validation')
- config: Configuration (num_voters, k)

Routing:
- intent='decision' or 'code_review' → consult_council
- intent='decomposition' → decompose_task
- intent='validation' → solve_with_voting
- No intent: automatically inferred from prompt`,
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The main query, question, or task to be executed"
        },
        context: {
          type: "object",
          description: "Additional context (code, history, filePath)",
          properties: {
            code: { type: "string", description: "Relevant code snippet" },
            history: {
              type: "array",
              description: "Array of past interactions",
              items: {
                type: "object",
                properties: {
                  role: { type: "string" },
                  content: { type: "string" }
                }
              }
            },
            filePath: { type: "string", description: "Path of the file being analyzed" }
          }
        },
        intent: {
          type: "string",
          enum: ["decision", "code_review", "decomposition", "validation"],
          description: "Explicit intent of the request"
        },
        config: {
          type: "object",
          description: "Execution configuration",
          properties: {
            num_voters: { type: "number", description: "Number of microagents (1-10)" },
            k: { type: "number", description: "Voting margin (1-10)" }
          }
        }
      },
      required: ["prompt"],
    },
  },
  {
    name: "consult_council",
    description: `Consult MAKER-Council using the complete algorithm from the paper.

Process:
1. Multiple microagents (voters) generate proposals using first-to-ahead-by-k voting
2. A senior judge analyzes proposals and synthesizes consensus
3. Red-flagging automatically discards problematic responses

Parameters:
- query: The question or code to be analyzed
- num_voters: Number of microagents (default: 3)
- k: First-to-ahead-by-k voting margin (default: 3)`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question or code to be analyzed" },
        num_voters: { type: "number", description: "Number of microagents (1-10)", default: 3 },
        k: { type: "number", description: "Voting margin (1-10)", default: 3 },
      },
      required: ["query"],
    },
  },
  {
    name: "solve_with_voting",
    description: `Solve a question using ONLY first-to-ahead-by-k voting (no judge).

Useful for questions with objective answers where statistical consensus is sufficient.
Faster and cheaper than consult_council.

Parameters:
- query: The question to be solved
- k: Voting margin (default: 3)`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question to be solved" },
        k: { type: "number", description: "Voting margin (1-10)", default: 3 },
      },
      required: ["query"],
    },
  },
  {
    name: "decompose_task",
    description: `Decomposes complex tasks into atomic steps (MAD - Maximal Agentic Decomposition).

Follows the MAKER methodology where each step must be:
- A single verifiable action
- Small enough for a microagent to execute without confusion
- With explicit dependencies

Returns JSON with the structured decomposition.`,
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The task to be decomposed" },
      },
      required: ["task"],
    },
  },
];

// ============================================================================
// MCP SERVER
// ============================================================================

async function main() {
  // Configuration is validated and the process can exit if MAKER_API_KEY doesn't exist
  // The 'config' object has already been validated when imported from 'config.ts'

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

  // Handler to list tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Handler to execute tools
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
          // Return as formatted JSON for the unified API
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

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MAKER-Council MCP Server started");
}

// Detect execution mode based on configuration or command-line argument
// MAKER_MCP_MODE=true forces MCP mode (used by MCP client)
// --mcp flag also enables MCP mode
// By default, when executed directly (npm run dev), starts HTTP server
const isMCPMode = config.mcpMode || process.argv.includes('--mcp');

if (isMCPMode) {
  // MCP mode: use stdin/stdout for communication with MCP client
  main().catch(console.error);
} else {
  // Standalone mode: start Express HTTP server (default behavior for dev)
  // Use async IIFE with await to ensure process waits for server to start
  (async () => {
    try {
      // await ensures the main script waits for server module execution
      await import('./server.js');
    } catch (error) {
      console.error('Failed to start HTTP server:', error);
      process.exit(1);
    }
  })();
}