# MAKER-Council MCP Server

<p align="center"><img src="banner.svg" alt="MAKER-Council Banner"/></p>
<div align="center">
  <br />
  <p>
    A Model Context Protocol (MCP) server that implements the MAKER methodology for complex task execution using consensus and voting.
  </p>
  <br />
</div>

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

**MAKER-Council** is a pure MCP server that provides advanced decision-making tools to your AI assistant. It implements the concepts from the "MAKER: Massively Decomposed Agentic Processes" paper, allowing for high-quality, consensus-driven responses through voting and judging mechanisms.

## ✨ Key Features

- **MAKER Methodology Tools**: Provides specialized tools like `consult_council` and `solve_with_voting` to leverage multiple internal micro-agents for better accuracy.
- **Task Decomposition**: Includes `decompose_task` to break down complex objectives into manageable steps.
- **Unified Query Interface**: Exposes a smart `query` tool that automatically routes requests to the appropriate internal strategy.
- **Pure MCP Implementation**: communicating entirely over stdio, making it compatible with any MCP client (Claude Desktop, Cline, etc.).

## 🚀 Getting Started

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-repo/maker-council.git
cd maker-council
npm install
npm run build
```

### 2. Configuration

Create a `.env` file in the root directory. You must provide an API key for the LLM provider (OpenAI by default).

```bash
cp .env.example .env
```

#### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|:--------:|
| `MAKER_API_KEY` | API key for the LLM provider. | - | ✅ |
| `MAKER_API_URL` | Base URL for the LLM API. | `https://api.openai.com/v1` | |
| `MAKER_API_MODEL` | Default model for operations. | `gpt-4o-mini` | |
| `MAKER_JUDGE_MODEL` | Model for the Senior Judge agent. | `gpt-4o` | |
| `MAKER_VOTER_MODEL` | Model for Voter/Microagent agents. | `gpt-4o-mini` | |
| `MAKER_K` | Voting margin 'k' for consensus. | `3` | |
| `MAKER_MAX_ROUNDS` | Max voting rounds before forcing decision. | `10` | |
| `DASHBOARD_PORT` | Port for the monitoring dashboard. | `3000` | |

### 3. Usage with MCP Clients

To use MAKER-Council with your favorite MCP client, add it to your configuration file.

#### Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "maker-council": {
      "command": "node",
      "args": [
        "path/to/maker-council/dist/index.js"
      ],
      "env": {
        "MAKER_API_KEY": "sk-..."
      }
    }
  }
}
```

#### Cline

Add the server in the MCP Servers tab:
- **Name**: maker-council
- **Command**: `node`
- **Args**: `path/to/maker-council/dist/index.js`
- **Env**: Add your `MAKER_API_KEY`

## 📊 Monitoring Dashboard

The server includes a real-time web dashboard to monitor requests, voting consensus, and agent performance.

### Running the Dashboard

To start the dashboard server:

```bash
npm run dashboard
```

Then open **[http://localhost:3000](http://localhost:3000)** in your browser.

### Features
- **Real-time Stats**: Track total requests, error rates, and latency.
- **Request Traces**: See step-by-step execution of MAKER algorithms (Voters, Judge, etc.).
- **Deep Debugging**: Inspect full JSON logs, prompts, and tool inputs/outputs.

> **Note**: The dashboard connects to the local SQLite database. Ensure the main MCP server is running or has been run to generate data.

## 🛠️ Tools Reference

This server exposes the following tools:

### 1. `query` (Recommended)
The unified entry point. It automatically routes your prompt to the most appropriate internal strategy based on intent or analysis.

**Arguments:**
- `prompt` (string): The main query or task.
- `context` (object, optional): Additional context (code, history, etc.).
- `intent` (string, optional): Explicit intent ('decision', 'validation', 'decomposition').
- `config` (object, optional): Overrides for voters or 'k' value.

### 2. `consult_council`
Uses the full MAKER algorithm. Multiple micro-agents (voters) generate proposals, and a senior judge synthesizes the best answer using a voting mechanism. Best for complex decisions or architectural questions.

**Arguments:**
- `query` (string): The question to be analyzed.
- `num_voters` (number): Number of microagents (1-10).
- `k` (number): Voting margin.

### 3. `solve_with_voting`
Solves a question using ONLY the "First-to-Ahead-by-k" voting mechanism (no judge synthesis). Faster and ideal for objective questions where statistical consensus is sufficient.

**Arguments:**
- `query` (string): The question to be solved.
- `k` (number): Voting margin.

### 4. `decompose_task`
Breaks down complex tasks into atomic, verifiable steps (MAD - Maximal Agentic Decomposition).

**Arguments:**
- `task` (string): The task to be decomposed.

## 📂 Project Structure

```
maker-council/
├── 📄 .env                  # Environment configuration
├── 📁 src/
│   ├── 📄 index.ts          # Main MCP server entry point
│   ├── 📄 tools.ts          # Tool definitions
│   ├── 📄 logic.ts          # Core MAKER logic implementation
│   ├── 📄 config.ts         # Configuration loader
│   └── 📄 types.ts          # Type definitions
├── 📄 package.json
└── 📄 README.md
```

## 📄 Reference

This project is an implementation inspired by the concepts in **"MAKER: Massively Decomposed Agentic Processes"** (arXiv:2511.09030v1) by Meyerson et al., 2025.
