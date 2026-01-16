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
  handleSeniorCodeReview,
  type MakerConfig,
  type QueryRequest,
  type QueryResponse,
  type Intent,
  type ToolUsed,
  type QueryContext,
  type QueryConfig
} from './logic.js';
import { config } from './config.js';

// Import Specs and Tasks modules
import * as specs from './specs.js';
import * as tasks from './tasks.js';
import type { TaskStatus } from './types/tasks.js';

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
    name: "senior_code_review",
    description: `Performs a deep, skeptical code review assuming the code was written by a junior developer.

This tool applies the Senior Code Reviewer protocol with heightened scrutiny:
- Security vulnerabilities (SQLi, XSS, auth issues, data exposure)
- Performance issues (N+1 queries, memory leaks, O(n^2) complexity)
- Code quality (SOLID, DRY, KISS, design patterns)
- Error handling (exception swallowing, null checks, edge cases)
- Testing & maintainability (coverage, documentation, config)

Returns a structured review with:
- Critical & Major issues with fixes
- Minor issues & suggestions
- Educational corner explaining concepts
- Quality score (1-10)`,
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The code to be reviewed. Include the full code snippet or file content."
        },
        language: {
          type: "string",
          description: "Programming language of the code (e.g., typescript, python, java). Auto-detected if not provided."
        },
        context: {
          type: "string",
          description: "Optional context about the code: what it does, where it runs, security requirements, etc."
        },
        focus_areas: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of specific areas to focus on: security, performance, architecture, error_handling, testing."
        }
      },
      required: ["code"],
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
  // ============================================================================
  // SPECS TOOLS
  // ============================================================================
  {
    name: "parse_spec",
    description: `Parse a PRD or specification document and extract structured information.

Uses LLM to analyze the document and create a structured spec with:
- Title and description
- Organized sections (goals, requirements, constraints, etc.)

The spec is saved to .maker/specs.json and becomes the current spec.`,
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The PRD or specification document content to parse" },
        workspace_path: { type: "string", description: "Optional workspace path (defaults to current directory)" }
      },
      required: ["content"],
    },
  },
  {
    name: "get_spec",
    description: `Get a specification by ID or the current/most recent spec.

Returns the full spec with all sections.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Optional spec ID. If not provided, returns the current spec." },
        workspace_path: { type: "string", description: "Optional workspace path" }
      },
      required: [],
    },
  },
  {
    name: "update_spec",
    description: `Update an existing specification.

Allows updating title, description, sections, or metadata.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Spec ID to update" },
        title: { type: "string", description: "New title" },
        description: { type: "string", description: "New description" },
        workspace_path: { type: "string", description: "Optional workspace path" }
      },
      required: ["id"],
    },
  },
  // ============================================================================
  // TASKS TOOLS
  // ============================================================================
  {
    name: "list_tasks",
    description: `List all tasks, optionally filtered by status.

Returns a formatted list with task IDs, titles, status, priority, and subtask progress.`,
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "in-progress", "done", "review", "deferred", "cancelled"],
          description: "Optional status filter"
        },
        workspace_path: { type: "string", description: "Optional workspace path" }
      },
      required: [],
    },
  },
  {
    name: "get_task",
    description: `Get detailed information about a specific task.

Returns the full task with description, details, test strategy, and all subtasks.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Task ID to retrieve" },
        workspace_path: { type: "string", description: "Optional workspace path" }
      },
      required: ["id"],
    },
  },
  {
    name: "next_task",
    description: `Get the next available task to work on.

Returns the first pending task that has no pending dependencies.
Ideal for determining what to work on next.`,
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: { type: "string", description: "Optional workspace path" }
      },
      required: [],
    },
  },
  {
    name: "add_task",
    description: `Add a new task to the task list.

Creates a task with pending status and optional priority/dependencies.`,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Brief task title" },
        description: { type: "string", description: "Task description" },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Task priority (default: medium)"
        },
        dependencies: {
          type: "array",
          items: { type: "number" },
          description: "IDs of tasks that must be completed first"
        },
        details: { type: "string", description: "Implementation details" },
        testStrategy: { type: "string", description: "How to verify the task is complete" },
        workspace_path: { type: "string", description: "Optional workspace path" }
      },
      required: ["title", "description"],
    },
  },
  {
    name: "set_task_status",
    description: `Update the status of a task or subtask.

Use "3.1" notation for subtasks (subtask 1 of task 3).
Marking a task as "done" also marks all its subtasks as done.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Task ID (number) or subtask ID (e.g., '3.1' for subtask 1 of task 3)"
        },
        status: {
          type: "string",
          enum: ["pending", "in-progress", "done", "review", "deferred", "cancelled"],
          description: "New status"
        },
        workspace_path: { type: "string", description: "Optional workspace path" }
      },
      required: ["id", "status"],
    },
  },
  {
    name: "expand_task",
    description: `Expand a task into subtasks using AI.

Uses LLM to analyze the task and generate 3-7 atomic subtasks.
Optionally accepts additional context to guide the expansion.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Task ID to expand" },
        prompt: { type: "string", description: "Optional additional context for expansion" },
        workspace_path: { type: "string", description: "Optional workspace path" }
      },
      required: ["id"],
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

        case "senior_code_review": {
          const review = await handleSeniorCodeReview(
            args?.code as string,
            args?.language as string | undefined,
            args?.context as string | undefined,
            args?.focus_areas as string[] | undefined
          );
          result = JSON.stringify(
            {
              result: review,
              metadata: {
                tool_used: 'senior_code_review',
                request_id: 'n/a',
                timestamp: new Date().toISOString(),
                performance: {
                  total_time_seconds: 0,
                },
                raw_output: review,
              },
            },
            null,
            2
          );
          break;
        }

        // ====================================================================
        // SPECS HANDLERS
        // ====================================================================
        case "parse_spec": {
          const parseResult = await specs.parseSpec(
            args?.content as string,
            args?.workspace_path as string | undefined
          );
          if (parseResult.success) {
            result = JSON.stringify({
              success: true,
              message: `Spec "${parseResult.spec?.title}" created with ID: ${parseResult.spec?.id}`,
              spec: parseResult.spec
            }, null, 2);
          } else {
            result = JSON.stringify({ success: false, error: parseResult.error }, null, 2);
          }
          break;
        }

        case "get_spec": {
          const spec = specs.getSpec(
            args?.id as string | undefined,
            args?.workspace_path as string | undefined
          );
          if (spec) {
            result = JSON.stringify(spec, null, 2);
          } else {
            result = JSON.stringify({ error: "No spec found" }, null, 2);
          }
          break;
        }

        case "update_spec": {
          const updated = specs.updateSpec(
            args?.id as string,
            {
              title: args?.title as string | undefined,
              description: args?.description as string | undefined,
            },
            args?.workspace_path as string | undefined
          );
          if (updated) {
            result = JSON.stringify({ success: true, spec: updated }, null, 2);
          } else {
            result = JSON.stringify({ success: false, error: "Spec not found" }, null, 2);
          }
          break;
        }

        // ====================================================================
        // TASKS HANDLERS
        // ====================================================================
        case "list_tasks": {
          const taskList = tasks.listTasks(
            args?.status as TaskStatus | undefined,
            args?.workspace_path as string | undefined
          );
          result = tasks.formatTaskList(taskList);
          break;
        }

        case "get_task": {
          const task = tasks.getTask(
            args?.id as number,
            args?.workspace_path as string | undefined
          );
          if (task) {
            result = tasks.formatTask(task);
          } else {
            result = `Task ${args?.id} not found.`;
          }
          break;
        }

        case "next_task": {
          const next = tasks.nextTask(args?.workspace_path as string | undefined);
          if (next) {
            result = tasks.formatTask(next);
          } else {
            result = "No pending tasks available. All tasks are either done or blocked by dependencies.";
          }
          break;
        }

        case "add_task": {
          const newTask = tasks.addTask(
            {
              title: args?.title as string,
              description: args?.description as string,
              priority: args?.priority as "high" | "medium" | "low" | undefined,
              dependencies: args?.dependencies as number[] | undefined,
              details: args?.details as string | undefined,
              testStrategy: args?.testStrategy as string | undefined,
            },
            args?.workspace_path as string | undefined
          );
          result = `✅ Task ${newTask.id} created: "${newTask.title}"\n\n${tasks.formatTask(newTask)}`;
          break;
        }

        case "set_task_status": {
          const updated = tasks.setTaskStatus(
            args?.id as string,
            args?.status as TaskStatus,
            args?.workspace_path as string | undefined
          );
          if (updated) {
            result = `✅ Status updated to "${args?.status}"\n\n${tasks.formatTask(updated)}`;
          } else {
            result = `Task ${args?.id} not found.`;
          }
          break;
        }

        case "expand_task": {
          const expandResult = await tasks.expandTask(
            args?.id as number,
            args?.prompt as string | undefined,
            args?.workspace_path as string | undefined
          );
          if (expandResult.success) {
            result = `✅ Task expanded with ${expandResult.subtasks_added} subtasks\n\n${tasks.formatTask(expandResult.task!)}`;
          } else {
            result = `❌ Failed to expand task: ${expandResult.error}`;
          }
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
  // Only log to stderr in MCP mode to keep stdout clean for JSON-RPC
  console.error("MAKER-Council MCP Server started");
}

// Start MCP server
main().catch(console.error);