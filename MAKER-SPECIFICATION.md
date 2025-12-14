# MAKER-Council MCP - Technical Specification

Based on the paper **"MAKER: Massively Decomposed Agentic Processes"** (arXiv:2511.09030v1)

## Overview

MAKER-Council is an implementation of the paper **"MAKER: Massively Decomposed Agentic Processes"** that offers two operating modes:

1. **MCP Server Mode** - Integration with Model Context Protocol-based tools (Roo, Claude Desktop)
2. **API Server Mode** - OpenAI-compatible HTTP server for integration with compatible tools (Roo Code, Cursor, etc.)

The system implements the MAKER methodology through:

1. **MAD** (Maximal Agentic Decomposition) - Decomposition into minimal subtasks
2. **First-to-ahead-by-k Voting** - Voting system with k margin for consensus
3. **Red-flagging** - Automatic discard of problematic responses

## Architecture

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

## Main Components

### 1. First-to-ahead-by-k Voting (Algorithm 2 from the paper)

```typescript
// Pseudocode
function firstToAheadByKVoting(prompt, k) {
  votes = new Map()
  
  // First deterministic sample (temp=0)
  sample1 = llm(prompt, temp=0)
  votes[sample1]++
  
  // Additional samples (temp>0)
  while (!hasWinner(votes, k)) {
    sample = llm(prompt, temp=0.7)
    
    // Red-flagging
    if (!isValid(sample)) continue
    
    votes[sample]++
  }
  
  return winner
}

function hasWinner(votes, k) {
  maxVotes = max(votes.values())
  secondMax = secondMax(votes.values())
  return maxVotes >= k + secondMax
}
```

### 2. Red-Flagging (Section 3.3 of the paper)

Criteria for discarding responses:

1. **Response too long** (> `MAKER_MAX_TOKENS`)
   - Indicates over-analysis or model confusion
   
2. **Empty response**
   - Generation failure

3. **Incorrect format** (future)
   - Indicates problematic reasoning

### 3. Maximal Agentic Decomposition (Section 3.1 of the paper)

Each task is decomposed into atomic steps where:
- Each step is a single verifiable action
- Small enough for a microagent to execute
- Explicit dependencies between steps

## MCP Tools

### `query` (Recommended Entry Point)

**Description**: Unified entry point that abstracts MAKER-Council complexity. The tool analyzes the request and routes it internally to the most appropriate subsystem (`consult_council`, `decompose_task`, or `solve_with_voting`), simplifying interaction for the client.

**Parameters**:

-   `prompt` (string, required): The main query, question, or task to be executed.
-   `context` (object, optional): Provides additional context (e.g., `code`, `history`, `filePath`).
-   `intent` (string, optional): Defines explicit intent for direct routing.
    -   `decision` / `code_review`: Routes to `consult_council`.
    -   `decomposition`: Routes to `decompose_task`.
    -   `validation`: Routes to `solve_with_voting`.
-   `config` (object, optional): Overrides default configuration (e.g., `num_voters`, `k`).

**Routing Logic**:

1.  **Explicit `intent`**: If the `intent` field is provided, the request is routed directly to the corresponding tool.
2.  **Inference by `prompt`**: If `intent` is not provided, the API infers the best tool based on keywords in the `prompt` (e.g., "decompose" -> `decompose_task`).
3.  **Default**: In case of ambiguity, `consult_council` is used as the default.

**Usage Example (Architectural Decision)**:

```json
{
  "prompt": "What is the best approach to implement authentication in a Node.js/Express API: JWT or sessions?",
  "intent": "decision",
  "config": {
    "num_voters": 5
  }
}
```

**Usage Example (Task Decomposition)**:

```json
{
  "prompt": "Decompose the task: 'Create a user login system'",
  "intent": "decomposition"
}
```

---

### Internal Tools (Advanced Usage)

The tools below are the main components of `maker-council`. While they can still be called directly, the recommended approach is to use the `query` tool which manages routing automatically.

### `consult_council`

**Description**: Full consultation with voting + judgment. **Direct use recommended only for advanced scenarios that need to bypass the `query` router.**

**Parameters**:
- `query` (string, required): Question to be analyzed
- `num_voters` (number, optional, default=3): Number of microagents
- `k` (number, optional, default=3): Voting margin

**Process**:
1. `num_voters` microagents generate independent proposals
2. Each microagent uses first-to-ahead-by-k voting
3. Senior judge analyzes all proposals
4. Judge synthesizes the best solution or identifies conflicts

**Usage example**:
```json
{
  "query": "Write a function to calculate fibonacci",
  "num_voters": 3,
  "k": 3
}
```

### `solve_with_voting`

**Description**: Fast resolution using only voting (no judge). **Direct use recommended only for advanced scenarios that need to bypass the `query` router.**

**Parameters**:
- `query` (string, required): Question to be solved
- `k` (number, optional, default=3): Voting margin

**Process**:
1. Sample multiple responses from the model
2. Apply first-to-ahead-by-k voting
3. Return the winning response

**When to use**: Objective questions with clear answer (calculations, facts, etc.)

### `decompose_task`

**Description**: Decomposes complex tasks into atomic steps (MAD). **Direct use recommended only for advanced scenarios that need to bypass the `query` router.**

**Parameters**:
- `task` (string, required): Task to be decomposed

**Output**: Structured JSON with:
```json
{
  "task": "original description",
  "total_steps": 10,
  "steps": [
    {
      "id": 1,
      "action": "specific action",
      "input": "what this step receives",
      "output": "what this step produces",
      "dependencies": []
    }
  ]
}
```

## Configuration

### Environment Variables (via MCP)

| Variable | Description | Default | GLM Example |
|----------|-------------|---------|-------------|
| `MAKER_API_KEY` | API key | - | `11afe...` |
| `MAKER_BASE_URL` | API base URL | `https://api.openai.com/v1` | `https://api.z.ai/api/coding/paas/v4` |
| `MAKER_JUDGE_MODEL` | Judge model | `gpt-4` | `GLM-4.6` |
| `MAKER_VOTER_MODEL` | Voters model | `gpt-3.5-turbo` | `GLM-4.5-air` |
| `MAKER_K` | Voting margin | `3` | `3` |
| `MAKER_MAX_TOKENS` | Limit for red-flag | `750` | `750` |
| `MAKER_MAX_ROUNDS` | Maximum rounds | `50` | `50` |

### MCP Configuration Example

```json
{
  "mcpServers": {
    "maker-council": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "path/to/maker-council",
      "env": {
        "MAKER_API_KEY": "your-api-key",
        "MAKER_BASE_URL": "https://api.z.ai/api/coding/paas/v4",
        "MAKER_JUDGE_MODEL": "GLM-4.6",
        "MAKER_VOTER_MODEL": "GLM-4.5-air",
        "MAKER_K": "3",
        "MAKER_MAX_TOKENS": "750"
      }
    }
  }
}
```

## API Server Mode (OpenAI Compatible)

In addition to MCP mode, MAKER-Council can operate as an HTTP server that exposes an OpenAI-compatible API. This allows integration with tools that support OpenAI-compatible providers.

### Endpoint: `/v1/chat/completions`

**Method**: `POST`

#### Request Body

```json
{
  "model": "string",              // Optional, ignored by MAKER-Council
  "messages": [                  // Required
    {
      "role": "system|user|assistant",
      "content": "string"
    }
  ],
  "temperature": number,         // Optional, ignored by MAKER-Council
  "max_tokens": number,          // Optional, ignored by MAKER-Council
  "maker_intent": "decision|code_review|decomposition|validation",  // Optional
  "maker_num_voters": number,    // Optional, 1-10, default: 3
  "maker_k": number              // Optional, 1-10, default: 3
}
```

#### MAKER-Council Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `maker_intent` | string | `inferred` | Explicit intent. If not provided, inferred from prompt |
| `maker_num_voters` | number | 3 | Number of microagents (used only with `consult_council`) |
| `maker_k` | number | 3 | First-to-ahead-by-k voting margin |

#### Response Body

```json
{
  "id": "chatcmpl-1234567890",
  "object": "chat.completion",
  "created": 1704067200,
  "model": "maker-council-v1",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "MAKER-Council response..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 200,
    "total_tokens": 300
  }
}
```

### Endpoint: `/v1/models`

**Method**: `GET`

Returns a fake model for compatibility with OpenAI clients.

```json
{
  "object": "list",
  "data": [
    {
      "id": "maker-council-v1",
      "object": "model",
      "created": 1704067200,
      "owned_by": "maker-council"
    }
  ]
}
```

### Endpoint: `/health`

**Method**: `GET`

Checks if the server is healthy.

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "version": "1.0.0"
}
```

### Internal Processing

1. **Message Extraction**: The API extracts the last user message from the `messages` array.
2. **Historical Context**: If there are previous messages, they are included as context in the history.
3. **Routing**: Based on `maker_intent` or inference, the request is routed to:
   - `consult_council`: For complex decisions
   - `solve_with_voting`: For validations and objective questions
   - `decompose_task`: For task decomposition
4. **Formatting**: The result is formatted as an OpenAI chat completion response.

### Server Configuration

The server is configured through the same environment variables as MCP mode, plus:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Port where the HTTP server listens |

### Complete Usage Example

```bash
# Start the server
npm run serve

# Send a decision request
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are an experienced software architect."},
      {"role": "user", "content": "What is the best approach for JWT vs Sessions authentication in a REST API?"}
    ],
    "maker_intent": "decision",
    "maker_num_voters": 5
  }'
```

## API Compatibility

MAKER-Council is compatible with any API that follows the OpenAI protocol:

### Z.AI (GLM)
```
Base URL: https://api.z.ai/api/coding/paas/v4
Models: GLM-4.6, GLM-4.5-air
```

### OpenRouter
```
Base URL: https://openrouter.ai/api/v1
Models: anthropic/claude-3-sonnet, etc.
```

### Official OpenAI
```
Base URL: https://api.openai.com/v1
Models: gpt-4, gpt-3.5-turbo
```

## Scalability (from the paper)

### Cost Law (Equation 18)

```
E[cost] = Θ(s × ln(s))
```

Where:
- `s` = number of steps
- **Log-linear** growth (very efficient!)

### Success Probability (Equation 13)

```
P[success] = (1 + ((1-p)/p)^k)^(-s)
```

Where:
- `p` = success rate per step
- `k` = voting margin
- `s` = number of steps

**Example**: With `p=0.995` and `k=3`, it's possible to solve tasks with **1 million steps** with high probability of success!

## Special GLM-4.6 Handling

GLM-4.6 returns responses in two fields:
- `content`: Final response
- `reasoning_content`: Intermediate reasoning

MAKER-Council handles both automatically:
```typescript
const message = response.choices[0].message;
const text = message.content || message.reasoning_content || "";
```

## Performance Metrics

Example `consult_council` report:

```
## Voting Metrics
- Total samples: 31
- Valid samples: 30
- Red-flagged: 1 (3.2%)

## Performance
- Total time: 188.19s
- Voting time: 163.12s
- Judgment time: 25.07s
```

## References

1. **Original Paper**: [MAKER: Massively Decomposed Agentic Processes](https://arxiv.org/abs/2511.09030) (arXiv:2511.09030v1)
2. **Z.AI Documentation**: https://docs.z.ai/
3. **Model Context Protocol**: https://modelcontextprotocol.io/

## Known Limitations

1. **Cost**: Multiple API calls increase cost
2. **Latency**: Voting requires time (mitigated with early termination)
3. **Error correlation**: Some steps may have abnormally high error rate

## Future Improvements

1. Implement semantic cache for similar responses
2. Add voter parallelization
3. Implement more aggressive early termination
4. Support for different matching functions (beyond exact match)
5. Real-time metrics via streaming
