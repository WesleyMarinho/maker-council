import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
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
