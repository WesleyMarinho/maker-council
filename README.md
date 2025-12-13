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

### `query` (Ponto de Entrada Recomendado)
Ponto de entrada unificado que roteia a requisição para a ferramenta interna mais adequada (`consult_council`, `solve_with_voting`, `decompose_task`). **Este é o método recomendado para todas as interações.**

**Parâmetros:**
- `prompt` (obrigatório): A questão ou tarefa a ser executada.
- `intent` (opcional): Ajuda a direcionar a requisição (`decision`, `decomposition`, `validation`).
- `context` (opcional): Objeto com contexto adicional (e.g., `code`).
- `config` (opcional): Sobrepõe configurações como `num_voters` e `k`.

**Exemplo de Uso:**
```json
{
  "prompt": "Refatore esta função para ser mais eficiente.",
  "context": {
    "code": "function inefficient() { ... }"
  },
  "intent": "code_review"
}
```

---

### Ferramentas Internas (Uso Avançado)

### `consult_council`
Consulta completa com votação e julgamento. **Normalmente invocado via `query`.**

**Parâmetros:**
- `query` (obrigatório): A questão ou código a ser analisado.
- `num_voters` (opcional, padrão: 3): Número de microagentes.
- `k` (opcional, padrão: 3): Margem de votação.

### `solve_with_voting`
Resolve usando apenas votação. **Normalmente invocado via `query`.**

**Parâmetros:**
- `query` (obrigatório): A questão a ser resolvida.
- `k` (opcional, padrão: 3): Margem de votação.

### `decompose_task`
Decompõe tarefas complexas. **Normalmente invocado via `query`.**

**Parâmetros:**
- `task` (obrigatório): A tarefa a ser decomposta.

## 🌐 Modo API Server (OpenAI Compatible)

O MAKER-Council também pode ser executado como um servidor HTTP que expõe uma API compatível com OpenAI. Isso permite que você configure o MAKER-Council como um "provedor de modelo" em ferramentas como o Roo Code, Cursor, ou qualquer cliente OpenAI-compatible.

### Iniciando o Servidor

```bash
# Iniciar o servidor API
npm run serve

# O servidor estará disponível em http://localhost:3000
```

### Configurando um Cliente

Configure seu cliente para usar:
- **URL Base**: `http://localhost:3000/v1`
- **Modelo**: `maker-council-v1` (ou qualquer nome, será ignorado)
- **API Key**: Não necessária (ou qualquer valor para autenticação básica)

#### Exemplo de Configuração no Roo Code

No arquivo de configuração do Roo Code:

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

#### Exemplo de Configuração no Cursor

```json
{
  "openAiBaseURL": "http://localhost:3000/v1",
  "openAiKey": "any-key-here",
  "model": "maker-council-v1"
}
```

### Parâmetros Especiais do MAKER-Council

A API aceita parâmetros adicionais no corpo da requisição para controlar o comportamento do MAKER-Council:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Qual é a melhor abordagem para implementar autenticação em APIs REST?"
    }
  ],
  "maker_intent": "decision",
  "maker_num_voters": 5,
  "maker_k": 3
}
```

| Parâmetro | Tipo | Valores Possíveis | Descrição |
|-----------|------|-------------------|-----------|
| `maker_intent` | string | `decision`, `code_review`, `decomposition`, `validation` | Força o uso de uma ferramenta específica |
| `maker_num_voters` | número | 1-10 | Número de microagentes (padrão: 3) |
| `maker_k` | número | 1-10 | Margem de votação (padrão: 3) |

### Endpoints Disponíveis

- `POST /v1/chat/completions` - Endpoint principal compatível com OpenAI
- `GET /v1/models` - Lista modelos disponíveis (compatibilidade)
- `GET /health` - Health check do servidor

### Testando com curl

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Qual é a melhor abordagem para autenticação em APIs?"}],
    "maker_intent": "decision"
  }'
```

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
| `PORT` | Porta do servidor API | `3000` |

## 📄 Referência

Paper: [MAKER: Massively Decomposed Agentic Processes](https://arxiv.org/abs/2511.09030)

> "Solving a Million-Step LLM Task with Zero Errors" - Meyerson et al., 2025