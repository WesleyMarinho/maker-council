# 🏛️ MAKER-Council MCP Server

Implementação do paper [MAKER: Massively Decomposed Agentic Processes](https://arxiv.org/pdf/2511.09030) (arXiv:2511.09030v1) como um servidor MCP (Model Context Protocol).

## 📋 O que é MAKER?

**MAKER** = **M**aximal **A**gentic decomposition + first-to-ahead-by-**K** **E**rror correction + **R**ed-flagging

É um framework que permite resolver tarefas com **milhões de passos LLM com zero erros**, algo impossível para LLMs tradicionais que inevitavelmente falham após algumas centenas de passos.

### O Problema

LLMs têm uma taxa de erro persistente. Por exemplo:
- Com 1% de erro por passo, após 100 passos a chance de sucesso é ~37%
- Após 1000 passos, a chance cai para ~0.004%
- Tarefas de 1 milhão de passos são impossíveis

### A Solução MAKER

O paper demonstra que é possível resolver tarefas de **1 milhão de passos com zero erros** através de três componentes:

## 🔧 Os Três Componentes

### 1. MAD (Maximal Agentic Decomposition)

Decomposição extrema de tarefas em **subtarefas mínimas**:
- Cada microagente foca em **uma única ação**
- Contexto limitado = menos confusão
- Permite usar modelos menores e mais baratos

### 2. First-to-ahead-by-k Voting

Sistema de votação estatística robusto:
- Múltiplas amostras independentes para cada subtarefa
- Um candidato vence quando tem **k votos a mais** que qualquer outro
- Baseado no Sequential Probability Ratio Test (SPRT)

```
Exemplo com k=3:
- Candidato A: 5 votos
- Candidato B: 2 votos
- A vence! (5 >= 3 + 2)
```

### 3. Red-Flagging

Descarte de respostas com sinais de erro:
- **Respostas muito longas**: Indicam over-analysis/confusão
- **Formato incorreto**: Indica raciocínio problemático
- Aumenta a taxa de sucesso efetiva (p)

## 📊 Scaling Laws

Do paper (Eq. 18):
```
E[custo] = Θ(s × ln(s))
```

Onde `s` é o número de passos. O custo cresce **log-linearmente**, não exponencialmente!

## 🚀 Instalação

### Pré-requisitos

- Python 3.10+
- [uv](https://docs.astral.sh/uv/) (gerenciador de pacotes)

### Setup

```bash
# Clone o repositório
git clone <repo-url>
cd maker-council

# Copie o arquivo de configuração
cp .env.example .env

# Edite o .env com suas configurações
# ANTHROPIC_API_KEY="sk-ant-..."

# Instale as dependências
uv sync
```

## ⚙️ Configuracao

Edite o arquivo `.env`:

```env
# Credenciais
ANTHROPIC_API_KEY="sua-chave"
ANTHROPIC_BASE_URL=""  # Opcional: para proxies OpenAI-compativeis

# Modelos (tiering para otimizacao de custo)
JUDGE_MODEL="claude-sonnet-4-5-20250929"   # Modelo inteligente (1 chamada)
VOTER_MODEL="claude-3-5-haiku-20241022"    # Modelo rapido (N chamadas)

# Parametros MAKER
MAKER_K=3              # Margem de votacao (first-to-ahead-by-k)
MAKER_MAX_TOKENS=750   # Threshold para red-flag de respostas longas
MAKER_MAX_ROUNDS=50    # Limite de seguranca para votacao

# Parametros de Performance
MAKER_MAX_CONCURRENT=10  # Requisicoes paralelas maximas
MAKER_BATCH_SIZE=5       # Amostras por lote de votacao
MAKER_CACHE_TTL=300      # TTL do cache em segundos
MAKER_CACHE_SIZE=100     # Tamanho maximo do cache
MAKER_EARLY_TERMINATION=true  # Cancelar tasks quando consenso alcancado
```

## ⚡ Otimizacoes de Performance

Esta versao inclui otimizacoes significativas para alto desempenho:

### Batch Voting Paralelo
- Dispara multiplas amostras simultaneamente em cada lote
- Controle de concorrencia via semaforo global
- Configuravel via `MAKER_BATCH_SIZE`

### Early Termination
- Cancela tasks pendentes quando consenso e alcancado
- Reduz drasticamente o tempo de resposta
- Habilitado por padrao (`MAKER_EARLY_TERMINATION=true`)

### Cache de Respostas
- Cache LRU com TTL para respostas deterministicas (temperature=0)
- Evita chamadas duplicadas para mesmos prompts
- Configuravel via `MAKER_CACHE_TTL` e `MAKER_CACHE_SIZE`

### Connection Pooling
- Reutilizacao de conexoes HTTP
- Timeout otimizado (60s request, 10s connect)
- Retry automatico (2 tentativas)

### Metricas de Performance
Os relatorios incluem metricas detalhadas:
```
## Performance
- Tempo total: 2.34s
- Tempo votacao (paralela): 1.89s
- Tempo julgamento: 0.45s
- Tempo medio por voter: 1.23s
- Early terminations: 2/3
- Eficiencia de paralelismo: 87.5%
- Cache hits: 5 (rate: 25.0%)
```

## 🏃 Execução

### Modo Standalone

```bash
uv run python server.py
```

### Modo Desenvolvimento (com Inspector)

```bash
uv run fastmcp dev server.py
```

### Como MCP Server

Adicione ao seu cliente MCP:

```json
{
  "mcpServers": {
    "maker-council": {
      "command": "uv",
      "args": ["run", "python", "server.py"],
      "cwd": "/caminho/para/maker-council"
    }
  }
}
```

## 🛠️ Ferramentas Disponíveis

### `consult_council`

Consulta completa usando o algoritmo MAKER.

**Processo:**
1. Múltiplos voters geram propostas usando votação first-to-ahead-by-k
2. Juiz sênior analisa e sintetiza o consenso
3. Red-flagging descarta respostas problemáticas

**Parâmetros:**
- `query`: A questão ou código a ser analisado
- `num_voters`: Número de microagentes (padrão: 3)
- `k`: Margem de votação (padrão: 3)

**Exemplo:**
```
Consulte o council: "Como implementar autenticação JWT segura?"
```

### `solve_with_voting`

Resolve usando **apenas votação** (sem juiz). Mais rápido e barato.

**Parâmetros:**
- `query`: A questão a ser resolvida
- `k`: Margem de votação (padrão: 3)

**Ideal para:**
- Questões com resposta objetiva
- Quando consenso estatístico é suficiente

### `decompose_task`

Decompõe tarefas em passos atômicos (MAD).

**Retorna JSON com:**
```json
{
  "task": "descrição original",
  "total_steps": 8,
  "steps": [
    {
      "id": 1,
      "action": "ação específica",
      "input": "o que recebe",
      "output": "o que produz",
      "dependencies": [],
      "is_atomic": true
    }
  ]
}
```

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                         ENTRADA (Query)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              FASE 1: VOTAÇÃO FIRST-TO-AHEAD-BY-K                │
│                                                                  │
│   Para cada Voter (Haiku):                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Loop até convergir:                                     │   │
│   │    1. Amostrar resposta (temp=0.7)                      │   │
│   │    2. Verificar red-flags                                │   │
│   │    3. Se válida, registrar voto                         │   │
│   │    4. Se candidato tem k votos a mais → VENCEDOR        │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│   Voters executam em PARALELO (asyncio.gather)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              FASE 2: JULGAMENTO (Sonnet 4.5)                    │
│                                                                  │
│   Recebe: Query + Propostas vencedoras dos voters               │
│                                                                  │
│   Decide:                                                        │
│   • CONSENSO → Sintetiza melhor solução                         │
│   • DIVERGÊNCIA → Escolhe mais robusta                          │
│   • PERIGO → Retorna "RED FLAG"                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SAÍDA (Relatório + Decisão)                   │
└─────────────────────────────────────────────────────────────────┘
```

## 📈 Por que funciona?

### Probabilidade de Sucesso (Eq. 9 do paper)

Com votação first-to-ahead-by-k:
```
P(correto) = 1 / (1 + ((1-p)/p)^k)
```

Onde `p` é a taxa de sucesso por amostra.

| p (taxa base) | k=1 | k=3 | k=5 |
|---------------|-----|-----|-----|
| 90% | 90% | 99.9% | 99.999% |
| 95% | 95% | 99.99% | 99.9999% |
| 99% | 99% | 99.9999% | ~100% |

### Custo Esperado (Eq. 18)

```
E[custo] = Θ(c × s × ln(s) / (v × p))
```

- `c`: custo por amostra
- `s`: número de passos
- `v`: taxa de amostras válidas (após red-flagging)
- `p`: taxa de sucesso por amostra

## 💰 Otimização de Custos

O sistema usa **tiering de modelos**:

| Componente | Modelo | Chamadas | Custo |
|------------|--------|----------|-------|
| Voters | Haiku (barato) | N × ~k | Baixo |
| Judge | Sonnet (inteligente) | 1 | Médio |

**Resultado**: Sistema financeiramente viável para uso diário.

## 🔒 Segurança

- API keys via variáveis de ambiente
- Red-flagging previne respostas problemáticas
- Votação estatística reduz erros correlacionados

## 📚 Referências

- [Paper MAKER (arXiv:2511.09030v1)](https://arxiv.org/pdf/2511.09030)
- [FastMCP Documentation](https://github.com/jlowin/fastmcp)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## 📄 Licença

MIT