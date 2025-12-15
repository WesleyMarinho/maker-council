# MAKER-Council MCP Server

Implementation of the paper **"MAKER: Massively Decomposed Agentic Processes"** (arXiv:2511.09030v1).

**MAKER** = **M**aximal **A**gentic decomposition + first-to-ahead-by-**K** **E**rror correction + **R**ed-flagging

## 📋 Overview

MAKER-Council is an implementation of the paper **"MAKER: Massively Decomposed Agentic Processes"** that offers two operating modes:

1. **MCP Server Mode** - Integration with Model Context Protocol-based tools (Roo Code, Claude Desktop)
2. **API Server Mode** - OpenAI-compatible HTTP server for integration with compatible tools (Roo Code, Cursor, etc.)

The system implements the MAKER methodology through:

1. **MAD** (Maximal Agentic Decomposition) - Decomposition into minimal subtasks
2. **First-to-ahead-by-k Voting** - Voting system with k margin for consensus
3. **Red-flagging** - Automatic discard of problematic responses

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Client (Roo/Claude)              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              MAKER-Council MCP Server                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Tool: consult_council                          │   │
│  │  ┌──────────────┐  ┌──────────────┐            │   │
│  │  │  Voter 1     │  │  Voter 2     │  ...       │   │
│  │  │ (GLM-4.5-air)│  │ (GLM-4.5-air)│            │   │
│  │  └──────┬───────┘  └──────┬───────┘            │   │
│  │         │                  │                     │   │
│  │         └────────┬─────────┘                     │   │
│  │                  ▼                               │   │
│  │          ┌──────────────┐                       │   │
│  │          │  Judge       │                       │   │
│  │          │ (GLM-4.6)    │                       │   │
│  │          └──────────────┘                       │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Tool: solve_with_voting                        │   │
│  │  (Voting only, no judge)                        │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Tool: decompose_task                           │   │
│  │  (MAD Decomposition)                            │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│         OpenAI-compatible API (Z.AI GLM)                │
└─────────────────────────────────────────────────────────┘
```

## 🧩 Main Components

### 1. First-to-ahead-by-k Voting (Algorithm 2 from the paper)
Microagents generate independent proposals. The process continues until a winner emerges with a margin of `k` votes over the second place.

### 2. Red-Flagging (Section 3.3 of the paper)
Criteria for automatically discarding responses:
- **Response too long** (> `MAKER_MAX_TOKENS`): Indicates over-analysis or model confusion.
- **Empty response**: Generation failure.
- **Incorrect format**: Indicates problematic reasoning.

### 3. Maximal Agentic Decomposition (Section 3.1 of the paper)
Each task is decomposed into atomic steps where:
- Each step is a single verifiable action.
- Small enough for a microagent to execute.
- Explicit dependencies between steps.

## 🚀 Installation

```bash
npm install
npm run build
```

## ⚙️ Configuration (Environment Variables)

| Variable | Description | Default | Example (GLM) |
|----------|-------------|---------|---------------|
| `MAKER_API_PORT` | API server port | `8338` | `8338` |
| `MAKER_API_KEY` | API key (required) | - | `11afe...` |
| `MAKER_API_URL` | API base URL (Priority over BASE_URL) | - | `https://api.z.ai/api/coding/paas/v4` |
| `MAKER_BASE_URL` | API base URL (Alternative) | `https://api.openai.com/v1` | `https://api.z.ai/api/coding/paas/v4` |
| `MAKER_API_MODEL` | Default fallback model | `gemini-3-pro-preview` | `glm-4.5-air` |
| `MAKER_JUDGE_MODEL` | Judge model | `gemini-3-pro-preview` | `glm-4.6` |
| `MAKER_VOTER_MODEL` | Voters model | `gemini-2.5-flash-lite` | `glm-4.5-air` |
| `MAKER_K` | Voting margin | `3` | `3` |
| `MAKER_MAX_TOKENS` | Limit for red-flag | `16000` | `16000` |
| `MAKER_MAX_ROUNDS` | Maximum rounds | `10` | `5` |
| `MAKER_MCP_MODE` | Force MCP mode (stdin/stdout) | `false` | `true` |
| `MAKER_FAST_MODE` | Enable fast mode for simple prompts | `true` | `true` |
| `MAKER_INCLUDE_REPORT` | Include technical report in response | `false` | `true` |
| `MAKER_SIMPLE_PROMPT_MAX_LENGTH` | Char limit for fast mode | `50` | `50` |

### MCP Client Configuration

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `MAKER_MCP_CLIENT_ENABLED` | Enable MCP client functionality | `false` | `true` |
| `MAKER_MCP_SERVERS` | MCP servers to connect to (JSON or simple format) | `[]` | See below |
| `MAKER_MCP_TIMEOUT` | Default timeout for tool execution (ms) | `30000` | `60000` |
| `MAKER_MCP_MAX_ITERATIONS` | Max iterations in agent loop | `10` | `20` |
| `MAKER_MCP_AUTO_RECONNECT` | Auto-reconnect on disconnect | `false` | `true` |

## 🔌 MCP Server Mode

Add to your MCP configuration file (e.g., `mcp.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "maker-council": {
      "command": "node",
      "args": ["path/to/maker-council/dist/index.js"],
      "env": {
        "MAKER_API_KEY": "your-api-key-here",
        "MAKER_BASE_URL": "https://api.openai.com/v1",
        "MAKER_JUDGE_MODEL": "gpt-4",
        "MAKER_VOTER_MODEL": "gpt-3.5-turbo",
        "MAKER_K": "3",
        "MAKER_MAX_TOKENS": "750"
      }
    }
  }
}
```

### Available Tools

#### `query` (Recommended Entry Point)
Unified entry point that routes the request to the most appropriate internal tool (`consult_council`, `solve_with_voting`, `decompose_task`). **This is the recommended method for all interactions.**

**Parameters:**
- `prompt` (required): The question or task to be executed.
- `intent` (optional): Helps direct the request (`decision`, `decomposition`, `validation`).
- `context` (optional): Object with additional context (e.g., `code`, `history`, `filePath`).
- `config` (optional): Overrides configuration such as `num_voters` and `k`.

**Routing Logic:**
1. **Explicit `intent`**: Routes directly (`decision` -> `consult_council`, `decomposition` -> `decompose_task`, `validation` -> `solve_with_voting`).
2. **Inference**: Infers intent from keywords in `prompt`.
3. **Default**: Falls back to `consult_council`.

#### Internal Tools (Advanced Usage)

- **`consult_council`**: Full consultation with voting + judgment. Used for complex decisions and code reviews.
- **`solve_with_voting`**: Fast resolution using only voting (no judge). Used for objective questions.
- **`decompose_task`**: Decomposes complex tasks into atomic steps (MAD).

## 🌐 API Server Mode (OpenAI Compatible)

MAKER-Council can run as an HTTP server exposing an OpenAI-compatible API. This allows integration with tools like Roo Code, Cursor, or any OpenAI-compatible client.

### Starting the Server

```bash
# Start the API server
npm run serve
# The server will be available at http://localhost:8338
```

### Configuration & Usage

Configure your client with:
- **Base URL**: `http://localhost:8338/v1`
- **Model**: `maker-council-v1` (ignored)
- **API Key**: Any value (ignored)

#### Special Parameters
You can control MAKER-Council behavior by passing additional parameters in the request body:

```json
{
  "messages": [{"role": "user", "content": "..."}],
  "maker_intent": "decision",
  "maker_num_voters": 5,
  "maker_k": 3
}
```

### Streaming Support

The server supports Server-Sent Events (SSE) on the `/v1/chat/completions` endpoint. This improves user experience by simulating real-time responses.

**Request with Streaming:**
To enable streaming, include `"stream": true` in your request body.

```json
{
  "model": "maker-council-v1",
  "messages": [{"role": "user", "content": "Explain the MAKER process."}],
  "stream": true,
  "maker_num_voters": 3,
  "maker_k": 3
}
```

**How It Works:**
1. **Internal Processing**: MAKER-Council processes the entire request synchronously (waiting for consensus among microagents).
2. **Streaming Simulation**: After obtaining the final response, the server sends it in small chunks (words) to the client.
3. **Chunk Format**: The response follows standard OpenAI SSE format (`data: {...}`).

**Note:** Since the processing is synchronous, there will be an initial delay before the first chunk is received.

### Endpoints
- `POST /v1/chat/completions`: Main OpenAI-compatible endpoint.
- `GET /v1/models`: List available models (fake for compatibility).
- `GET /health`: Server health check.

## 🔧 MCP Client Mode (NEW)

MAKER-Council can now act as an **MCP Client**, connecting to other MCP servers to discover and execute their tools. This enables the MAKER agent to use external tools during its reasoning process.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MAKER-Council Agent                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              McpToolManager                          │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │    │
│  │  │McpConnection│  │McpConnection│  │McpConnection│  │    │
│  │  │  (Server 1) │  │  (Server 2) │  │  (Server N) │  │    │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │    │
│  └─────────┼────────────────┼────────────────┼─────────┘    │
└────────────┼────────────────┼────────────────┼──────────────┘
             │                │                │
             ▼                ▼                ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   MCP Server 1  │  │   MCP Server 2  │  │   MCP Server N  │
│   (e.g., fs)    │  │   (e.g., git)   │  │   (custom)      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Configuration

#### JSON Format (Recommended)
```bash
export MAKER_MCP_CLIENT_ENABLED=true
export MAKER_MCP_SERVERS='[
  {
    "name": "filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
  },
  {
    "name": "git",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-git"]
  }
]'
```

#### Simple Format
For quick configuration, use a semicolon-separated format:
```bash
export MAKER_MCP_SERVERS='filesystem:npx:-y:@modelcontextprotocol/server-filesystem:/tmp;git:npx:-y:@modelcontextprotocol/server-git'
```

Format: `name:command:arg1:arg2:...;name2:command2:arg1:...`

### Usage in Code

```typescript
import {
  initializeMcpClient,
  executeAgentLoop,
  handleQueryWithTools,
  getMcpToolManager,
  shutdownMcpClient
} from './logic.js';

// Initialize MCP client (connects to configured servers)
await initializeMcpClient();

// Execute an agent loop with tool support
const result = await executeAgentLoop(
  "List all files in the current directory and summarize them",
  undefined, // optional custom system prompt
  {
    maxIterations: 10,
    toolTimeout: 30000,
    model: 'gpt-4',
    temperature: 0.7,
  }
);

console.log(result.response);
console.log(`Tools called: ${result.toolsCalled.length}`);

// Or use the unified query handler with tools
const response = await handleQueryWithTools({
  prompt: "What git branches exist in this repository?",
  intent: 'decision',
});

// Shutdown when done
await shutdownMcpClient();
```

### Key Components

#### McpToolManager
The main entry point for managing MCP connections:
- `initialize()`: Connect to all configured servers
- `getAllTools()`: Get all available tools from all servers
- `executeTool(request)`: Execute a tool by name
- `getToolsAsOpenAI()`: Get tools in OpenAI function format
- `shutdown()`: Disconnect from all servers

#### McpConnection
Handles individual server connections:
- Manages stdio transport lifecycle
- Discovers tools via `listTools`
- Executes tools via `callTool`
- Supports auto-reconnect

#### ToolSchemaTranslator
Converts between MCP and LLM tool formats:
- `toOpenAITool()`: Convert MCP tool to OpenAI format
- `toAnthropicTool()`: Convert MCP tool to Anthropic format
- `validateArguments()`: Validate tool arguments against schema

### Agent Loop

The agent loop enables iterative tool use:

1. **Initial Call**: Send user prompt with available tools to LLM
2. **Tool Detection**: Check if LLM requested tool calls
3. **Tool Execution**: Execute requested tools via McpToolManager
4. **Result Injection**: Feed tool results back to LLM
5. **Repeat**: Continue until LLM provides final response (or max iterations)

```
User Prompt → LLM (with tools) → Tool Calls?
                                    │
                    ┌───────────────┴───────────────┐
                    │ Yes                           │ No
                    ▼                               ▼
            Execute Tools                    Final Response
                    │
                    ▼
            Feed Results to LLM
                    │
                    └──────────→ Loop
```

## 📂 Project Structure

```
maker-council/
├── 📄 DOC 2511.09030v1.pdf          # Original MAKER paper
├── 📄 README.md                      # This file
├── 📄 package.json                   # Node.js dependencies
├── 📄 tsconfig.json                  # TypeScript configuration
├── 📁 src/                           # TypeScript source code
│   ├── 📄 index.ts                   # Main MCP implementation
│   ├── 📄 server.ts                  # OpenAI-compatible HTTP server
│   ├── 📄 logic.ts                   # MAKER-Council processing logic
│   ├── 📄 config.ts                  # Configuration management
│   └── 📁 mcp-client/                # MCP Client infrastructure
│       ├── 📄 index.ts               # Module exports
│       ├── 📄 types.ts               # Type definitions
│       ├── 📄 McpConnection.ts       # Individual server connections
│       ├── 📄 McpToolManager.ts      # Multi-server management
│       └── 📄 ToolSchemaTranslator.ts # Schema conversion utilities
├── 📁 tests/                         # Automated tests
├── 📁 dist/                          # Compiled code (generated)
└── 📁 .roo/                          # Roo configuration
```

## 📊 Scalability & Performance

- **Cost Law**: `E[cost] = Θ(s × ln(s))` (Log-linear growth).
- **Success Probability**: `P[success] = (1 + ((1-p)/p)^k)^(-s)`.
  - With `p=0.995` and `k=3`, it's possible to solve tasks with **1 million steps** with high probability of success!

## 📄 Reference

Paper: [MAKER: Massively Decomposed Agentic Processes](https://arxiv.org/abs/2511.09030)
> "Solving a Million-Step LLM Task with Zero Errors" - Meyerson et al., 2025
