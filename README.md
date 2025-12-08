# MAKER-Council MCP Server

Implementação do paper **"MAKER: Massively Decomposed Agentic Processes"** (arXiv:2511.09030v1).

**MAKER** = **M**aximal **A**gentic decomposition + first-to-ahead-by-**K** **E**rror correction + **R**ed-flagging

## 🚀 Instalação

```bash
npm install
npm run build
```

## ⚙️ Configuração no MCP

Adicione ao seu arquivo de configuração MCP (ex: `mcp.json` ou `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "maker-council": {
      "command": "node",
      "args": ["caminho/para/maker-council/dist/index.js"],
      "env": {
        "MAKER_API_KEY": "sua-api-key-aqui",
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

### Exemplo com GLM (Z.AI)

```json
{
  "mcpServers": {
    "maker-council": {
      "command": "node",
      "args": ["caminho/para/maker-council/dist/index.js"],
      "env": {
        "MAKER_API_KEY": "sua-glm-api-key",
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

### Exemplo com OpenRouter

```json
{
  "mcpServers": {
    "maker-council": {
      "command": "node",
      "args": ["caminho/para/maker-council/dist/index.js"],
      "env": {
        "MAKER_API_KEY": "sua-openrouter-key",
        "MAKER_BASE_URL": "https://openrouter.ai/api/v1",
        "MAKER_JUDGE_MODEL": "anthropic/claude-3-sonnet",
        "MAKER_VOTER_MODEL": "anthropic/claude-3-haiku",
        "MAKER_K": "3"
      }
    }
  }
}
```

## 🛠️ Ferramentas Disponíveis

### `consult_council`
Consulta o MAKER-Council com votação first-to-ahead-by-k e julgamento final.

**Parâmetros:**
- `query` (obrigatório): A questão ou código a ser analisado
- `num_voters` (opcional, padrão: 3): Número de microagentes
- `k` (opcional, padrão: 3): Margem de votação

### `solve_with_voting`
Resolve usando apenas votação (sem juiz). Mais rápido e barato.

**Parâmetros:**
- `query` (obrigatório): A questão a ser resolvida
- `k` (opcional, padrão: 3): Margem de votação

### `decompose_task`
Decompõe tarefas complexas em passos atômicos (MAD).

**Parâmetros:**
- `task` (obrigatório): A tarefa a ser decomposta

## 📊 Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `MAKER_API_KEY` | Chave da API (obrigatório) | - |
| `MAKER_BASE_URL` | URL base da API | `https://api.openai.com/v1` |
| `MAKER_JUDGE_MODEL` | Modelo para o juiz | `gpt-4` |
| `MAKER_VOTER_MODEL` | Modelo para os voters | `gpt-3.5-turbo` |
| `MAKER_K` | Margem de votação | `3` |
| `MAKER_MAX_TOKENS` | Limite para red-flagging | `750` |
| `MAKER_MAX_ROUNDS` | Máximo de rounds | `50` |

## 📄 Referência

Paper: [MAKER: Massively Decomposed Agentic Processes](https://arxiv.org/abs/2511.09030)

> "Solving a Million-Step LLM Task with Zero Errors" - Meyerson et al., 2025