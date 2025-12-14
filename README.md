# MAKER-Council MCP Server

Implementation of the paper **"MAKER: Massively Decomposed Agentic Processes"** (arXiv:2511.09030v1).

**MAKER** = **M**aximal **A**gentic decomposition + first-to-ahead-by-**K** **E**rror correction + **R**ed-flagging

## 🚀 Installation

```bash
npm install
npm run build
```

## ⚙️ MCP Configuration

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

### Example with GLM (Z.AI)

```json
{
  "mcpServers": {
    "maker-council": {
      "command": "node",
      "args": ["path/to/maker-council/dist/index.js"],
      "env": {
        "MAKER_API_KEY": "your-glm-api-key",
        "MAKER_BASE_URL": "https://open.bigmodel.cn/api/paas/v4",
        "MAKER_JUDGE_MODEL": "glm-4",
        "MAKER_VOTER_MODEL": "glm-4-flash",
        "MAKER_K": "3",
        "MAKER_MAX_TOKENS": "750"
      }
    }
  }
}
```

### Example with OpenRouter

```json
{
  "mcpServers": {
    "maker-council": {
      "command": "node",
      "args": ["path/to/maker-council/dist/index.js"],
      "env": {
        "MAKER_API_KEY": "your-openrouter-key",
        "MAKER_BASE_URL": "https://openrouter.ai/api/v1",
        "MAKER_JUDGE_MODEL": "anthropic/claude-3-sonnet",
        "MAKER_VOTER_MODEL": "anthropic/claude-3-haiku",
        "MAKER_K": "3"
      }
    }
  }
}
```

## 🛠️ Available Tools

### `query` (Recommended Entry Point)
Unified entry point that routes the request to the most appropriate internal tool (`consult_council`, `solve_with_voting`, `decompose_task`). **This is the recommended method for all interactions.**

**Parameters:**
- `prompt` (required): The question or task to be executed.
- `intent` (optional): Helps direct the request (`decision`, `decomposition`, `validation`).
- `context` (optional): Object with additional context (e.g., `code`).
- `config` (optional): Overrides configuration such as `num_voters` and `k`.

**Usage Example:**
```json
{
  "prompt": "Refactor this function to be more efficient.",
  "context": {
    "code": "function inefficient() { ... }"
  },
  "intent": "code_review"
}
```

---

### Internal Tools (Advanced Usage)

### `consult_council`
Full consultation with voting and judgment. **Normally invoked via `query`.**

**Parameters:**
- `query` (required): The question or code to be analyzed.
- `num_voters` (optional, default: 3): Number of microagents.
- `k` (optional, default: 3): Voting margin.

### `solve_with_voting`
Solve using only voting. **Normally invoked via `query`.**

**Parameters:**
- `query` (required): The question to be solved.
- `k` (optional, default: 3): Voting margin.

### `decompose_task`
Decomposes complex tasks. **Normally invoked via `query`.**

**Parameters:**
- `task` (required): The task to be decomposed.

## 🌐 API Server Mode (OpenAI Compatible)

MAKER-Council can also be run as an HTTP server that exposes an OpenAI-compatible API. This allows you to configure MAKER-Council as a "model provider" in tools like Roo Code, Cursor, or any OpenAI-compatible client.

### Starting the Server

```bash
# Start the API server
npm run serve

# The server will be available at http://localhost:3000
```

### Configuring a Client

Configure your client to use:
- **Base URL**: `http://localhost:3000/v1`
- **Model**: `maker-council-v1` (or any name, will be ignored)
- **API Key**: Not required (or any value for basic authentication)

#### Example Configuration in Roo Code

In the Roo Code configuration file:

```json
{
  "modelProvider": "openai-compatible",
  "openai": {
    "baseUrl": "http://localhost:3000/v1",
    "apiKey": "any-key-here",
    "model": "maker-council-v1"
  }
}
```

#### Example Configuration in Cursor

```json
{
  "openAiBaseURL": "http://localhost:3000/v1",
  "openAiKey": "any-key-here",
  "model": "maker-council-v1"
}
```

### MAKER-Council Special Parameters

The API accepts additional parameters in the request body to control MAKER-Council behavior:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "What is the best approach for implementing authentication in REST APIs?"
    }
  ],
  "maker_intent": "decision",
  "maker_num_voters": 5,
  "maker_k": 3
}
```

| Parameter | Type | Possible Values | Description |
|-----------|------|-----------------|-------------|
| `maker_intent` | string | `decision`, `code_review`, `decomposition`, `validation` | Forces the use of a specific tool |
| `maker_num_voters` | number | 1-10 | Number of microagents (default: 3) |
| `maker_k` | number | 1-10 | Voting margin (default: 3) |

### Available Endpoints

- `POST /v1/chat/completions` - Main OpenAI-compatible endpoint
- `GET /v1/models` - List available models (compatibility)
- `GET /health` - Server health check

### Testing with curl

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "What is the best approach for authentication in APIs?"}],
    "maker_intent": "decision"
  }'
```

## 📊 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MAKER_API_KEY` | API key (required) | - |
| `MAKER_BASE_URL` | API base URL | `https://api.openai.com/v1` |
| `MAKER_JUDGE_MODEL` | Model for the judge | `gpt-4` |
| `MAKER_VOTER_MODEL` | Model for the voters | `gpt-3.5-turbo` |
| `MAKER_K` | Voting margin | `3` |
| `MAKER_MAX_TOKENS` | Limit for red-flagging | `750` |
| `MAKER_MAX_ROUNDS` | Maximum rounds | `50` |
| `PORT` | API server port | `3000` |

## 📄 Reference

Paper: [MAKER: Massively Decomposed Agentic Processes](https://arxiv.org/abs/2511.09030)

> "Solving a Million-Step LLM Task with Zero Errors" - Meyerson et al., 2025