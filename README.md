# MAKER-Council

<p align="center"><img src="banner.svg" alt="MAKER-Council Banner"/></p>
<div align="center">
  <br />
  <p>
    An intelligent, tool-dispatching API server that uses a council of LLM agents to perform complex tasks, based on the MAKER paper methodology.
  </p>
  <br />
</div>

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

**MAKER-Council** is an advanced API server that acts as an intelligent dispatcher. It interprets user prompts and routes them to the most appropriate tool from a unified registry, which includes both powerful internal capabilities and external tools connected via the Model-Context Protocol (MCP).

## ✨ Key Features

- **Intelligent Tool Dispatcher**: Uses a powerful LLM to analyze user prompts and automatically select the best tool for the job, similar to OpenAI's Function Calling.
- **Extensible via MCPs**: Easily add new capabilities (e.g., file system access, git operations, web search) by configuring external MCP servers in a simple JSON manifest.
- **Robust Decision Making**: Implements core concepts from the MAKER paper, such as `consult_council` (voting + judging) and `solve_with_voting` for high-quality, consensus-driven responses.
- **OpenAI-Compatible API**: Drop-in replacement for any client compatible with the OpenAI API, making integration seamless.
- **Streaming Support**: Provides real-time, streamed responses for a better user experience.

## 🚀 Getting Started

### 1. Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/your-repo/maker-council.git
cd maker-council
npm install
```

### 2. Configuration

Configuration is handled through a `.env` file and a JSON manifest for tools.

#### a) Environment Variables

Create a `.env` file in the root of the project by copying the `.env.example`. At a minimum, you must provide your LLM provider's API key.

```bash
# .env
MAKER_API_KEY="your-llm-provider-api-key"
MAKER_API_URL="https://api.openai.com/v1" # Or your provider's URL
MAKER_JUDGE_MODEL="gpt-4-turbo"          # A powerful model for routing and judging
MAKER_VOTER_MODEL="gpt-3.5-turbo"        # A faster model for generating proposals
```

#### b) External Tools (MCPs)

External tools are registered in the `maker-mcps/mcp.json` file. This allows you to extend the council's capabilities.

*Example `maker-mcps/mcp.json`:*
```json
{
  "mcpServers": [
    {
      "name": "serena",
      "command": "uvx",
      "args": ["serena", "start-mcp-server"],
      "enabled": true,
      "provider": "roocode"
    },
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"],
      "enabled": false
    }
  ]
}
```
To use external tools, enable the client in your `.env` file:
```bash
# .env
MAKER_MCP_CLIENT_ENABLED=true
```

### 3. Running the Server

Build the project and start the server:

```bash
npm run build
npm run serve
```
The server will be available at `http://localhost:8338`.

## ⚙️ Usage

Interact with the server using any OpenAI-compatible client. The server intelligently dispatches your prompt to the best available tool.

**Example: Using `curl` to analyze a file (will be routed to the `serena` MCP)**

```bash
curl --location 'http://localhost:8338/v1/chat/completions' \
--header 'Content-Type: application/json' \
--data '{
  "messages": [{
    "role": "user",
    "content": "Analyze the file structure of `src/logic.ts` and list its main exports."
  }]
}'
```

**Example: Using `curl` for a complex decision (will be routed to the internal `consult_council` tool)**

```bash
curl --location 'http://localhost:8338/v1/chat/completions' \
--header 'Content-Type: application/json' \
--data '{
  "messages": [{
    "role": "user",
    "content": "What is the best architecture for a real-time notification system: WebSockets or Server-Sent Events? Justify the choice."
  }]
}'
```

## 核心概念

### Internal Tools

MAKER-Council comes with powerful built-in tools inspired by the MAKER paper:

- **`consult_council`**: The primary tool for complex problems. It gathers proposals from multiple "voter" agents and uses a "judge" agent to synthesize the best possible answer.
- **`solve_with_voting`**: A faster version that relies only on consensus voting. Ideal for objective questions with a clear-cut answer.
- **`decompose_task`**: Breaks down a large, complex task into a sequence of smaller, actionable steps.

### Intelligent Dispatcher

You no longer need to specify which tool to use. The new logic in `handleQuery` automatically presents your prompt and the list of all available tools (both internal and external) to a router LLM, which then decides the best course of action.

## 📂 Project Structure
```
maker-council/
├── 📄 .env                          # Local environment configuration
├── 📁 maker-mcps/
│   └── 📄 mcp.json                  # External tool (MCP) manifest
├── 📁 src/
│   ├── 📄 server.ts                 # OpenAI-compatible HTTP server
│   ├── 📄 logic.ts                  # Core dispatcher and tool execution logic
│   ├── 📄 config.ts                 # Configuration loader
│   ├── 📄 internal-tools.ts        # Schema definitions for built-in tools
│   └── 📁 mcp-client/               # Infrastructure for connecting to MCPs
├── 📄 README.md                      # This file
└── ...
```

## 📄 Reference

This project is an implementation inspired by the concepts in **"MAKER: Massively Decomposed Agentic Processes"** (arXiv:2511.09030v1) by Meyerson et al., 2025.
