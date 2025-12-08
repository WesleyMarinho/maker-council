# MAKER-Council MCP - Especificação Técnica

Baseado no paper **"MAKER: Massively Decomposed Agentic Processes"** (arXiv:2511.09030v1)

## Visão Geral

O MAKER-Council é um servidor MCP (Model Context Protocol) que implementa a metodologia MAKER para resolver problemas complexos através de:

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

### `consult_council`

**Descrição**: Consulta completa com votação + julgamento

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

**Descrição**: Resolução rápida usando apenas votação (sem juiz)

**Parâmetros**:
- `query` (string, obrigatório): Questão a ser resolvida
- `k` (number, opcional, padrão=3): Margem de votação

**Processo**:
1. Amostra múltiplas respostas do modelo
2. Aplica first-to-ahead-by-k voting
3. Retorna a resposta vencedora

**Quando usar**: Questões objetivas com resposta clara (cálculos, fatos, etc.)

### `decompose_task`

**Descrição**: Decompõe tarefas complexas em passos atômicos (MAD)

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