# MAKER-Council MCP - Especificação Técnica

Baseado no paper **"MAKER: Massively Decomposed Agentic Processes"** (arXiv:2511.09030v1)

## Visão Geral

O MAKER-Council é uma implementação do paper **"MAKER: Massively Decomposed Agentic Processes"** que oferece duas modalidades de operação:

1. **Modo MCP Server** - Integração com ferramentas baseadas em Model Context Protocol (Roo, Claude Desktop)
2. **Modo API Server** - Servidor HTTP compatível com OpenAI para integração com ferramentas compatíveis (Roo Code, Cursor, etc.)

O sistema implementa a metodologia MAKER através de:

1. **MAD** (Maximal Agentic Decomposition) - Decomposição em subtarefas mínimas
2. **First-to-ahead-by-k Voting** - Sistema de votação com margem k para consenso
3. **Red-flagging** - Descarte automático de respostas problemáticas

## Arquitetura

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
│  │  (Apenas votação, sem juiz)                     │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Tool: decompose_task                           │   │
│  │  (Decomposição MAD)                             │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│         API OpenAI-compatible (Z.AI GLM)                │
└─────────────────────────────────────────────────────────┘
```

## Componentes Principais

### 1. First-to-ahead-by-k Voting (Algoritmo 2 do paper)

```typescript
// Pseudocódigo
function firstToAheadByKVoting(prompt, k) {
  votes = new Map()
  
  // Primeira amostra determinística (temp=0)
  sample1 = llm(prompt, temp=0)
  votes[sample1]++
  
  // Amostras adicionais (temp>0)
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

### 2. Red-Flagging (Seção 3.3 do paper)

Critérios para descartar respostas:

1. **Resposta muito longa** (> `MAKER_MAX_TOKENS`)
   - Indica over-analysis ou confusão do modelo
   
2. **Resposta vazia**
   - Falha na geração

3. **Formato incorreto** (futuro)
   - Indica raciocínio problemático

### 3. Maximal Agentic Decomposition (Seção 3.1 do paper)

Cada tarefa é decomposta em passos atômicos onde:
- Cada passo é uma única ação verificável
- Pequeno o suficiente para um microagente executar
- Dependências explícitas entre passos

## Ferramentas MCP

### `query` (Ponto de Entrada Recomendado)

**Descrição**: Ponto de entrada unificado que abstrai a complexidade do MAKER-Council. A ferramenta analisa a requisição e a roteia internamente para o sub-sistema mais apropriado (`consult_council`, `decompose_task`, ou `solve_with_voting`), simplificando a interação para o cliente.

**Parâmetros**:

-   `prompt` (string, obrigatório): A consulta principal, pergunta ou tarefa a ser executada.
-   `context` (object, opcional): Fornece contexto adicional (e.g., `code`, `history`, `filePath`).
-   `intent` (string, opcional): Define a intenção explícita para roteamento direto.
    -   `decision` / `code_review`: Roteia para `consult_council`.
    -   `decomposition`: Roteia para `decompose_task`.
    -   `validation`: Roteia para `solve_with_voting`.
-   `config` (object, opcional): Sobrepõe configurações padrão (e.g., `num_voters`, `k`).

**Lógica de Roteamento**:

1.  **`intent` Explícito**: Se o campo `intent` for fornecido, a requisição é roteada diretamente para a ferramenta correspondente.
2.  **Inferência por `prompt`**: Se o `intent` não for fornecido, a API infere a melhor ferramenta com base em palavras-chave no `prompt` (e.g., "decomponha" -> `decompose_task`).
3.  **Padrão**: Em caso de ambiguidade, `consult_council` é usado como padrão.

**Exemplo de Uso (Decisão Arquitetural)**:

```json
{
  "prompt": "Qual a melhor abordagem para implementar autenticação em uma API Node.js/Express: JWT ou sessions?",
  "intent": "decision",
  "config": {
    "num_voters": 5
  }
}
```

**Exemplo de Uso (Decomposição de Tarefa)**:

```json
{
  "prompt": "Decomponha a tarefa: 'Criar um sistema de login de usuário'",
  "intent": "decomposition"
}
```

---

### Ferramentas Internas (Uso Avançado)

As ferramentas abaixo são os componentes principais do `maker-council`. Embora ainda possam ser chamadas diretamente, a abordagem recomendada é usar a ferramenta `query` que gerencia o roteamento automaticamente.

### `consult_council`

**Descrição**: Consulta completa com votação + julgamento. **Uso direto recomendado apenas para cenários avançados que necessitam bypassar o roteador `query`.**

**Parâmetros**:
- `query` (string, obrigatório): Questão a ser analisada
- `num_voters` (number, opcional, padrão=3): Número de microagentes
- `k` (number, opcional, padrão=3): Margem de votação

**Processo**:
1. `num_voters` microagentes geram propostas independentes
2. Cada microagente usa votação first-to-ahead-by-k
3. Juiz sênior analisa todas as propostas
4. Juiz sintetiza a melhor solução ou identifica conflitos

**Exemplo de uso**:
```json
{
  "query": "Escreva uma função para calcular fibonacci",
  "num_voters": 3,
  "k": 3
}
```

### `solve_with_voting`

**Descrição**: Resolução rápida usando apenas votação (sem juiz). **Uso direto recomendado apenas para cenários avançados que necessitam bypassar o roteador `query`.**

**Parâmetros**:
- `query` (string, obrigatório): Questão a ser resolvida
- `k` (number, opcional, padrão=3): Margem de votação

**Processo**:
1. Amostra múltiplas respostas do modelo
2. Aplica first-to-ahead-by-k voting
3. Retorna a resposta vencedora

**Quando usar**: Questões objetivas com resposta clara (cálculos, fatos, etc.)

### `decompose_task`

**Descrição**: Decompõe tarefas complexas em passos atômicos (MAD). **Uso direto recomendado apenas para cenários avançados que necessitam bypassar o roteador `query`.**

**Parâmetros**:
- `task` (string, obrigatório): Tarefa a ser decomposta

**Saída**: JSON estruturado com:
```json
{
  "task": "descrição original",
  "total_steps": 10,
  "steps": [
    {
      "id": 1,
      "action": "ação específica",
      "input": "o que este passo recebe",
      "output": "o que este passo produz",
      "dependencies": []
    }
  ]
}
```

## Configuração

### Variáveis de Ambiente (via MCP)

| Variável | Descrição | Padrão | Exemplo GLM |
|----------|-----------|--------|-------------|
| `MAKER_API_KEY` | Chave da API | - | `11afe...` |
| `MAKER_BASE_URL` | URL base da API | `https://api.openai.com/v1` | `https://api.z.ai/api/coding/paas/v4` |
| `MAKER_JUDGE_MODEL` | Modelo do juiz | `gpt-4` | `GLM-4.6` |
| `MAKER_VOTER_MODEL` | Modelo dos voters | `gpt-3.5-turbo` | `GLM-4.5-air` |
| `MAKER_K` | Margem de votação | `3` | `3` |
| `MAKER_MAX_TOKENS` | Limite para red-flag | `750` | `750` |
| `MAKER_MAX_ROUNDS` | Máximo de rounds | `50` | `50` |

### Exemplo de Configuração MCP

```json
{
  "mcpServers": {
    "maker-council": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "caminho/para/maker-council",
      "env": {
        "MAKER_API_KEY": "sua-api-key",
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

## API Server Modo (OpenAI Compatible)

Além do modo MCP, o MAKER-Council pode operar como um servidor HTTP que expõe uma API compatível com OpenAI. Isso permite integração com ferramentas que suportam provedores OpenAI-compatíveis.

### Endpoint: `/v1/chat/completions`

**Método**: `POST`

#### Corpo da Requisição

```json
{
  "model": "string",              // Opcional, ignorado pelo MAKER-Council
  "messages": [                  // Obrigatório
    {
      "role": "system|user|assistant",
      "content": "string"
    }
  ],
  "temperature": number,         // Opcional, ignorado pelo MAKER-Council
  "max_tokens": number,          // Opcional, ignorado pelo MAKER-Council
  "maker_intent": "decision|code_review|decomposition|validation",  // Opcional
  "maker_num_voters": number,    // Opcional, 1-10, padrão: 3
  "maker_k": number              // Opcional, 1-10, padrão: 3
}
```

#### Parâmetros MAKER-Council

| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|--------|-----------|
| `maker_intent` | string | `inferido` | Intent explícito. Se não fornecido, inferido do prompt |
| `maker_num_voters` | número | 3 | Número de microagentes (usado apenas com `consult_council`) |
| `maker_k` | número | 3 | Margem de votação first-to-ahead-by-k |

#### Corpo da Resposta

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
        "content": "Resposta do MAKER-Council..."
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

**Método**: `GET`

Retorna um modelo falso para compatibilidade com clientes OpenAI.

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

**Método**: `GET`

Verifica se o servidor está saudável.

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "version": "1.0.0"
}
```

### Processamento Interno

1. **Extração da Mensagem**: A API extrai a última mensagem do usuário do array `messages`.
2. **Contexto Histórico**: Se houver mensagens anteriores, elas são incluídas como contexto no histórico.
3. **Roteamento**: Baseado no `maker_intent` ou inferência, a requisição é roteada para:
   - `consult_council`: Para decisões complexas
   - `solve_with_voting`: Para validações e questões objetivas
   - `decompose_task`: Para decomposição de tarefas
4. **Formatação**: O resultado é formatado como uma resposta de chat completion OpenAI.

### Configuração do Servidor

O servidor é configurado através das mesmas variáveis de ambiente do modo MCP, mais:

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | 3000 | Porta onde o servidor HTTP escuta |

### Exemplo de Uso Completo

```bash
# Iniciar o servidor
npm run serve

# Enviar uma requisição de decisão
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "Você é um arquiteto de software experiente."},
      {"role": "user", "content": "Qual é a melhor abordagem para autenticação JWT vs Sessions em uma API REST?"}
    ],
    "maker_intent": "decision",
    "maker_num_voters": 5
  }'
```

## Compatibilidade com APIs

O MAKER-Council é compatível com qualquer API que siga o protocolo OpenAI:

### Z.AI (GLM)
```
Base URL: https://api.z.ai/api/coding/paas/v4
Modelos: GLM-4.6, GLM-4.5-air
```

### OpenRouter
```
Base URL: https://openrouter.ai/api/v1
Modelos: anthropic/claude-3-sonnet, etc.
```

### OpenAI Oficial
```
Base URL: https://api.openai.com/v1
Modelos: gpt-4, gpt-3.5-turbo
```

## Escalabilidade (do paper)

### Lei de Custo (Equação 18)

```
E[custo] = Θ(s × ln(s))
```

Onde:
- `s` = número de passos
- Crescimento **log-linear** (muito eficiente!)

### Probabilidade de Sucesso (Equação 13)

```
P[sucesso] = (1 + ((1-p)/p)^k)^(-s)
```

Onde:
- `p` = taxa de acerto por passo
- `k` = margem de votação
- `s` = número de passos

**Exemplo**: Com `p=0.995` e `k=3`, é possível resolver tarefas com **1 milhão de passos** com alta probabilidade de sucesso!

## Tratamento Especial GLM-4.6

O GLM-4.6 retorna respostas em dois campos:
- `content`: Resposta final
- `reasoning_content`: Raciocínio intermediário

O MAKER-Council trata ambos automaticamente:
```typescript
const message = response.choices[0].message;
const text = message.content || message.reasoning_content || "";
```

## Métricas de Performance

Exemplo de relatório de `consult_council`:

```
## Métricas de Votação
- Total de amostras: 31
- Amostras válidas: 30
- Red-flagged: 1 (3.2%)

## Performance
- Tempo total: 188.19s
- Tempo votação: 163.12s
- Tempo julgamento: 25.07s
```

## Referências

1. **Paper Original**: [MAKER: Massively Decomposed Agentic Processes](https://arxiv.org/abs/2511.09030) (arXiv:2511.09030v1)
2. **Z.AI Documentation**: https://docs.z.ai/
3. **Model Context Protocol**: https://modelcontextprotocol.io/

## Limitações Conhecidas

1. **Custo**: Múltiplas chamadas à API aumentam o custo
2. **Latência**: Votação requer tempo (mitigado com early termination)
3. **Correlação de erros**: Alguns passos podem ter erro rate anormalmente alto

## Melhorias Futuras

1. Implementar cache semântico para respostas similares
2. Adicionar paralelização de voters
3. Implementar early termination mais agressivo
4. Suporte para diferentes funções de matching (além de exact match)
5. Métricas em tempo real via streaming