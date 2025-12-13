# Especificação da API "MCP Model"

**Versão:** 1.0

## 1. Visão Geral

A API "MCP Model" serve como um ponto de entrada unificado e uma camada de abstração sobre o `maker-council`. Ela simplifica a interação para agentes consumidores, permitindo que eles submetam uma consulta sem a necessidade de conhecer a ferramenta específica do `maker-council` a ser usada. A API analisa a requisição e roteia internamente para a ferramenta mais apropriada (`consult_council`, `decompose_task`, ou `solve_with_voting`).

## 2. Endpoint

A API será exposta através de um único endpoint.

- **Método:** `POST`
- **Endpoint:** `/mcp/model`

## 3. Estrutura da Requisição (Request Body)

O corpo da requisição deve ser um objeto JSON com a seguinte estrutura:

```json
{
  "prompt": "string (obrigatório)",
  "context": "object (opcional)",
  "intent": "string (opcional)",
  "config": "object (opcional)"
}
```

### Detalhes dos Campos:

- **`prompt`** (string, obrigatório): A consulta principal, pergunta ou tarefa a ser executada. Este é o conteúdo principal que será analisado.

- **`context`** (object, opcional): Um objeto que fornece contexto adicional para a consulta. Pode incluir:
    - `code`: Uma string ou trecho de código relevante.
    - `history`: Um array de interações passadas.
    - `filePath`: O caminho do arquivo que está sendo analisado.
    - Outros metadados relevantes.

- **`intent`** (string, opcional): Indica a intenção explícita da requisição. Ajuda a API a rotear diretamente para a ferramenta correta, evitando a necessidade de inferência.
    - **Valores Permitidos:**
        - `decision`: Para obter uma decisão ou análise complexa. Mapeia para `consult_council`.
        - `code_review`: Para obter uma revisão de código. Mapeia para `consult_council`.
        - `decomposition`: Para quebrar uma tarefa em passos menores. Mapeia para `decompose_task`.
        - `validation`: Para obter uma resposta rápida e objetiva através de votação. Mapeia para `solve_with_voting`.

- **`config`** (object, opcional): Permite a passagem de parâmetros de configuração que sobrepõem os padrões do `maker-council`.
    - `num_voters` (number): Número de microagentes para `consult_council`.
    - `k` (number): Margem de votação para `consult_council` e `solve_with_voting`.
    - `model` (string): Para especificar um modelo de LLM para a execução.

## 4. Lógica de Roteamento Interno

A API utiliza uma lógica de roteamento em cascata para determinar qual ferramenta do `maker-council` invocar:

1.  **Verificação de `intent` explícito:** Se o campo `intent` for fornecido, o roteamento é direto:
    - `intent: 'decision'` -> `consult_council`
    - `intent: 'code_review'` -> `consult_council`
    - `intent: 'decomposition'` -> `decompose_task`
    - `intent: 'validation'` -> `solve_with_voting`

2.  **Inferência por `prompt` (Fallback):** Se `intent` não for fornecido, a API tentará inferir a intenção analisando o `prompt`:
    - Se o prompt contiver palavras-chave como "decomponha", "divida em passos", "crie um plano para" -> `decompose_task`.
    - Se o prompt fizer uma pergunta direta que espera uma resposta factual ou uma escolha simples (ex: "Qual a melhor biblioteca para X?", "Usar A ou B?") -> `solve_with_voting`.
    - Para todos os outros casos, como análises complexas, revisões de código, ou perguntas abertas -> `consult_council` (padrão).

## 5. Estrutura da Resposta (Response Body)

A resposta da API normaliza o output das diferentes ferramentas em uma estrutura JSON consistente.

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

### Detalhes dos Campos:

- **`result`** (object | string): O resultado principal da consulta.
    - Para `decompose_task`, será um objeto JSON com a decomposição.
    - Para `consult_council` e `solve_with_voting`, será uma string formatada em markdown com a decisão ou resposta.
- **`metadata`** (object): Contém metadados sobre a execução.
    - `tool_used` (string): O nome da ferramenta do `maker-council` que foi invocada (`consult_council`, `decompose_task`, `solve_with_voting`).
    - `request_id` (string): Um identificador único para a requisição.
    - `timestamp` (string): Data e hora da resposta no formato ISO 8601.
    - `performance` (object): Métricas de performance, como o tempo total de execução.
    - `raw_output` (string): O output bruto completo retornado pela ferramenta do `maker-council`, útil para depuração.

## 6. Exemplos de Uso

### Exemplo 1: Decisão Arquitetural (usando `consult_council`)

**Requisição:**
```json
{
  "prompt": "Qual a melhor abordagem para implementar autenticação em uma API Node.js/Express: JWT ou sessions?",
  "context": {
    "code": "const app = express(); // ... código base da API"
  },
  "intent": "decision",
  "config": {
    "num_voters": 5
  }
}
```

**Resposta Esperada (simplificada):**
```json
{
  "result": "# MAKER-Council Report\n\n## Decisão Final do Juiz\n\nA abordagem recomendada é JWT com refresh tokens...",
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

### Exemplo 2: Decomposição de Tarefa (usando `decompose_task`)

**Requisição:**
```json
{
  "prompt": "Decomponha a tarefa: 'Criar um sistema de login de usuário'",
  "intent": "decomposition"
}
```

**Resposta Esperada:**
```json
{
  "result": {
    "task": "Criar um sistema de login de usuário",
    "total_steps": 5,
    "steps": [
      { "id": 1, "action": "Criar a UI do formulário de login (email, senha)", "dependencies": [] },
      { "id": 2, "action": "Criar o endpoint da API POST /login", "dependencies": [] },
      { "id": 3, "action": "Validar as credenciais do usuário contra o banco de dados", "dependencies": [2] },
      { "id": 4, "action": "Gerar e retornar um token JWT em caso de sucesso", "dependencies": [3] },
      { "id": 5, "action": "Retornar um erro 401 em caso de falha", "dependencies": [3] }
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

### Exemplo 3: Validação Rápida (usando `solve_with_voting`, com inferência de intent)

**Requisição:**
```json
{
  "prompt": "Para manipulação de datas em JS, é melhor usar 'moment.js' ou 'date-fns' em um novo projeto em 2025?"
}
```

**Resposta Esperada (simplificada):**
```json
{
  "result": "# Resultado da Votação First-to-ahead-by-3\n\n## Resposta Vencedora\n\n'date-fns', por ser mais moderna, modular e imutável.",
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
