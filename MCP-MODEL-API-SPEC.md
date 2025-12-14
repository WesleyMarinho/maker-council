# "MCP Model" API Specification

**Version:** 1.0

## 1. Overview

The "MCP Model" API serves as a unified entry point and abstraction layer over `maker-council`. It simplifies interaction for consuming agents, allowing them to submit a query without needing to know the specific `maker-council` tool to use. The API analyzes the request and routes internally to the most appropriate tool (`consult_council`, `decompose_task`, or `solve_with_voting`).

## 2. Endpoint

The API will be exposed through a single endpoint.

- **Method:** `POST`
- **Endpoint:** `/mcp/model`

## 3. Request Structure (Request Body)

The request body should be a JSON object with the following structure:

```json
{
  "prompt": "string (required)",
  "context": "object (optional)",
  "intent": "string (optional)",
  "config": "object (optional)"
}
```

### Field Details:

- **`prompt`** (string, required): The main query, question, or task to be executed. This is the main content that will be analyzed.

- **`context`** (object, optional): An object that provides additional context for the query. May include:
    - `code`: A string or relevant code snippet.
    - `history`: An array of past interactions.
    - `filePath`: The path of the file being analyzed.
    - Other relevant metadata.

- **`intent`** (string, optional): Indicates the explicit intent of the request. Helps the API route directly to the correct tool, avoiding the need for inference.
    - **Allowed Values:**
        - `decision`: To get a decision or complex analysis. Maps to `consult_council`.
        - `code_review`: To get a code review. Maps to `consult_council`.
        - `decomposition`: To break a task into smaller steps. Maps to `decompose_task`.
        - `validation`: To get a quick and objective response through voting. Maps to `solve_with_voting`.

- **`config`** (object, optional): Allows passing configuration parameters that override `maker-council` defaults.
    - `num_voters` (number): Number of microagents for `consult_council`.
    - `k` (number): Voting margin for `consult_council` and `solve_with_voting`.
    - `model` (string): To specify an LLM model for execution.

## 4. Internal Routing Logic

The API uses cascading routing logic to determine which `maker-council` tool to invoke:

1.  **Check for explicit `intent`:** If the `intent` field is provided, routing is direct:
    - `intent: 'decision'` -> `consult_council`
    - `intent: 'code_review'` -> `consult_council`
    - `intent: 'decomposition'` -> `decompose_task`
    - `intent: 'validation'` -> `solve_with_voting`

2.  **Inference by `prompt` (Fallback):** If `intent` is not provided, the API will try to infer the intent by analyzing the `prompt`:
    - If the prompt contains keywords like "decompose", "divide into steps", "create a plan for" -> `decompose_task`.
    - If the prompt asks a direct question expecting a factual answer or simple choice (e.g., "What's the best library for X?", "Use A or B?") -> `solve_with_voting`.
    - For all other cases, such as complex analyses, code reviews, or open questions -> `consult_council` (default).

## 5. Response Structure (Response Body)

The API response normalizes the output of different tools into a consistent JSON structure.

```json
{
  "result": "object | string",
  "metadata": {
    "tool_used": "string",
    "request_id": "string",
    "timestamp": "string",
    "performance": {
      "total_time_seconds": "number"
    },
    "raw_output": "string"
  }
}
```

### Field Details:

- **`result`** (object | string): The main result of the query.
    - For `decompose_task`, it will be a JSON object with the decomposition.
    - For `consult_council` and `solve_with_voting`, it will be a markdown-formatted string with the decision or answer.
- **`metadata`** (object): Contains metadata about execution.
    - `tool_used` (string): The name of the `maker-council` tool that was invoked (`consult_council`, `decompose_task`, `solve_with_voting`).
    - `request_id` (string): A unique identifier for the request.
    - `timestamp` (string): Date and time of the response in ISO 8601 format.
    - `performance` (object): Performance metrics, such as total execution time.
    - `raw_output` (string): The complete raw output returned by the `maker-council` tool, useful for debugging.

## 6. Usage Examples

### Example 1: Architectural Decision (using `consult_council`)

**Request:**
```json
{
  "prompt": "What is the best approach to implement authentication in a Node.js/Express API: JWT or sessions?",
  "context": {
    "code": "const app = express(); // ... base API code"
  },
  "intent": "decision",
  "config": {
    "num_voters": 5
  }
}
```

**Expected Response (simplified):**
```json
{
  "result": "# MAKER-Council Report\n\n## Judge's Final Decision\n\nThe recommended approach is JWT with refresh tokens...",
  "metadata": {
    "tool_used": "consult_council",
    "request_id": "uuid-1234-abcd",
    "timestamp": "2025-12-13T14:30:00Z",
    "performance": {
      "total_time_seconds": 45.7
    },
    "raw_output": "..."
  }
}
```

### Example 2: Task Decomposition (using `decompose_task`)

**Request:**
```json
{
  "prompt": "Decompose the task: 'Create a user login system'",
  "intent": "decomposition"
}
```

**Expected Response:**
```json
{
  "result": {
    "task": "Create a user login system",
    "total_steps": 5,
    "steps": [
      { "id": 1, "action": "Create login form UI (email, password)", "dependencies": [] },
      { "id": 2, "action": "Create API endpoint POST /login", "dependencies": [] },
      { "id": 3, "action": "Validate user credentials against database", "dependencies": [2] },
      { "id": 4, "action": "Generate and return JWT token on success", "dependencies": [3] },
      { "id": 5, "action": "Return 401 error on failure", "dependencies": [3] }
    ]
  },
  "metadata": {
    "tool_used": "decompose_task",
    "request_id": "uuid-5678-efgh",
    "timestamp": "2025-12-13T14:32:00Z",
    "performance": {
      "total_time_seconds": 12.1
    },
    "raw_output": "..."
  }
}
```

### Example 3: Quick Validation (using `solve_with_voting`, with intent inference)

**Request:**
```json
{
  "prompt": "For date manipulation in JS, is it better to use 'moment.js' or 'date-fns' in a new project in 2025?"
}
```

**Expected Response (simplified):**
```json
{
  "result": "# First-to-ahead-by-3 Voting Result\n\n## Winning Answer\n\n'date-fns', for being more modern, modular and immutable.",
  "metadata": {
    "tool_used": "solve_with_voting",
    "request_id": "uuid-9012-ijkl",
    "timestamp": "2025-12-13T14:35:00Z",
    "performance": {
      "total_time_seconds": 21.5
    },
    "raw_output": "..."
  }
}
```
