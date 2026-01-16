# Regras de Uso do MAKER-Council MCP

> **Versão:** 2.0 | **Atualizado:** 2026-01-16

---

## 🎯 QUANDO USAR O MAKER-COUNCIL

### ✅ USE `query` (API Unificada - RECOMENDADO) para:
- **Qualquer consulta** - Roteamento automático baseado no prompt
- **Quando não sabe qual ferramenta usar** - O sistema infere a intenção
- **Integração simplificada** - Um único ponto de entrada

### ✅ USE `consult_council` para:
- **Decisões arquiteturais** - Escolha de padrões, estrutura de projeto
- **Refactoring complexo** - Mudanças que afetam múltiplos arquivos
- **Código crítico** - Autenticação, pagamentos, segurança
- **Divergências técnicas** - Quando há múltiplas abordagens válidas
- **Code review** - Validar implementação antes de aplicar
- **Bugs difíceis** - Quando a causa raiz não é óbvia

### ✅ USE `solve_with_voting` para:
- **Perguntas com resposta objetiva** - "Qual é a sintaxe correta?"
- **Escolhas binárias** - "Usar async/await ou Promises?"
- **Validação rápida** - Confirmar se uma abordagem está correta
- **Problemas bem definidos** - Quando há consenso esperado

### ✅ USE `decompose_task` para:
- **Tarefas complexas** - Antes de iniciar implementação grande
- **Planejamento** - Quebrar épicos em tarefas menores
- **Estimativas** - Entender escopo de trabalho

### ❌ NÃO USE para:
- Tarefas triviais (criar arquivo simples, renomear variável)
- Operações CRUD básicas
- Correções de sintaxe óbvias
- Quando você já sabe a resposta correta

---

## 📋 SPECS - Gerenciamento de Especificações

### ✅ USE `parse_spec` para:
- **Criar spec estruturada** a partir de PRD ou documento de requisitos
- **Extrair goals/requisitos** de textos não estruturados
- **Iniciar novo projeto** com especificações claras

### ✅ USE `get_spec` para:
- **Consultar spec atual** ou por ID específico
- **Ver seções e requisitos** do projeto

### ✅ USE `update_spec` para:
- **Atualizar título/descrição** de spec existente
- **Refinar requisitos** após feedback

### Formato de uso:

```xml
<use_mcp_tool>
<server_name>maker-council</server_name>
<tool_name>parse_spec</tool_name>
<arguments>
{
  "content": "# MVP Sistema de Pagamentos\n\n## Goals\n- Aceitar cartões de crédito\n- Processar PIX\n\n## Requisitos\n1. Integrar com gateway\n2. Logs de auditoria"
}
</arguments>
</use_mcp_tool>
```

---

## ✅ TASKS - Gerenciamento de Tarefas

### ✅ USE `list_tasks` para:
- **Ver todas as tasks** do projeto
- **Filtrar por status** (pending, in-progress, done, etc.)

### ✅ USE `get_task` para:
- **Ver detalhes** de uma task específica
- **Ver subtasks** e status de progresso

### ✅ USE `next_task` para:
- **Saber o que fazer agora** - Retorna task pendente sem dependências bloqueantes

### ✅ USE `add_task` para:
- **Criar nova task** com título, descrição, prioridade
- **Definir dependências** entre tasks

### ✅ USE `set_task_status` para:
- **Marcar progresso** (pending → in-progress → done)
- **Atualizar subtasks** usando notação "3.1" (subtask 1 da task 3)

### ✅ USE `expand_task` para:
- **Gerar subtasks automaticamente** usando LLM
- **Detalhar task complexa** em passos menores

### Exemplos:

```xml
<!-- Adicionar task -->
<use_mcp_tool>
<server_name>maker-council</server_name>
<tool_name>add_task</tool_name>
<arguments>
{
  "title": "Implementar autenticação",
  "description": "Sistema JWT com refresh tokens",
  "priority": "high",
  "dependencies": []
}
</arguments>
</use_mcp_tool>

<!-- Expandir em subtasks -->
<use_mcp_tool>
<server_name>maker-council</server_name>
<tool_name>expand_task</tool_name>
<arguments>
{
  "id": 1,
  "prompt": "Considerar integração com OAuth"
}
</arguments>
</use_mcp_tool>

<!-- Próxima task -->
<use_mcp_tool>
<server_name>maker-council</server_name>
<tool_name>next_task</tool_name>
<arguments>{}
</arguments>
</use_mcp_tool>

<!-- Atualizar status -->
<use_mcp_tool>
<server_name>maker-council</server_name>
<tool_name>set_task_status</tool_name>
<arguments>
{
  "id": "1",
  "status": "in-progress"
}
</arguments>
</use_mcp_tool>
```

---

## 📋 FORMATO DE CONSULTA

### Para `query` (API Unificada - RECOMENDADO):

```xml
<use_mcp_tool>
<server_name>maker-council</server_name>
<tool_name>query</tool_name>
<arguments>
{
  "prompt": "Sua pergunta ou tarefa aqui",
  "context": {
    "code": "// código relevante (opcional)",
    "filePath": "src/exemplo.ts"
  },
  "intent": "decision",
  "config": {
    "num_voters": 3,
    "k": 3
  }
}
</arguments>
</use_mcp_tool>
```

**Parâmetros:**
- `prompt` (obrigatório): A pergunta ou tarefa principal
- `context` (opcional): Objeto com contexto adicional
  - `code`: Trecho de código relevante
  - `history`: Array de interações passadas `[{role, content}]`
  - `filePath`: Caminho do arquivo sendo analisado
- `intent` (opcional): Intenção explícita - `'decision'`, `'code_review'`, `'decomposition'`, `'validation'`
- `config` (opcional): Configuração de execução
  - `num_voters`: Número de microagentes (1-10)
  - `k`: Margem de votação (1-10)

**Roteamento automático:**
- `intent='decision'` ou `'code_review'` → `consult_council`
- `intent='decomposition'` → `decompose_task`
- `intent='validation'` → `solve_with_voting`
- Sem intent: inferido automaticamente do prompt

### Para `consult_council`:

```xml
<use_mcp_tool>
<server_name>maker-council</server_name>
<tool_name>consult_council</tool_name>
<arguments>
{
  "query": "CONTEXTO:\n[Descreva o contexto]\n\nPROBLEMA:\n[Descreva o problema]\n\nOPÇÕES CONSIDERADAS:\n1. [Opção A]\n2. [Opção B]\n\nCRITÉRIOS:\n- [O que é importante]",
  "num_voters": 3,
  "k": 3
}
</arguments>
</use_mcp_tool>
```

### Para `solve_with_voting`:

```xml
<use_mcp_tool>
<server_name>maker-council</server_name>
<tool_name>solve_with_voting</tool_name>
<arguments>
{
  "query": "[Pergunta direta e objetiva]",
  "k": 3
}
</arguments>
</use_mcp_tool>
```

### Para `decompose_task`:

```xml
<use_mcp_tool>
<server_name>maker-council</server_name>
<tool_name>decompose_task</tool_name>
<arguments>
{
  "task": "Implementar [funcionalidade] que deve:\n1. [Requisito 1]\n2. [Requisito 2]"
}
</arguments>
</use_mcp_tool>
```

---

## ⚙️ PARÂMETROS RECOMENDADOS

| Cenário | num_voters | k | Motivo |
|---------|------------|---|--------|
| **Decisão rápida** | 3 | 3 | Convergência rápida |
| **Decisão importante** | 5 | 3 | Mais perspectivas |
| **Código crítico** | 5 | 5 | Máxima confiança |
| **Exploração** | 3 | 2 | Aceitar primeira boa ideia |

---

## 🚨 RED FLAGS - ATENÇÃO

### Se o Council retornar "RED FLAG:":
1. **PARE** - Não implemente a solução
2. **ANALISE** - Leia a explicação do conflito
3. **REFORMULE** - Faça uma nova consulta mais específica
4. **ESCALE** - Se persistir, peça ajuda ao usuário

### Se a taxa de red-flag for alta (>30%):
- A pergunta pode estar mal formulada
- Divida em perguntas menores
- Adicione mais contexto

---

## 📝 BOAS PRÁTICAS

### 1. Forneça Contexto Suficiente
```
❌ Ruim: "Como implementar autenticação?"
✅ Bom: "Preciso implementar autenticação JWT em uma API Node.js/Express. 
        O projeto usa TypeScript, já tem middleware de rate limiting.
        Requisitos: refresh tokens, logout em todos dispositivos."
```

### 2. Seja Específico sobre Constraints
```
❌ Ruim: "Qual banco de dados usar?"
✅ Bom: "Escolher banco de dados para sistema de logs.
        Constraints: 10M eventos/dia, retenção 30 dias, 
        queries por timestamp e user_id, orçamento limitado."
```

### 3. Inclua Código Relevante
```
✅ Bom: "Refatorar esta função para melhor testabilidade:
        
        ```typescript
        async function processOrder(orderId: string) {
          const order = await db.orders.findById(orderId);
          // ...
        }
        ```"
```

---

## 🔄 WORKFLOW RECOMENDADO

### Para Features Novas (com Specs/Tasks):
```
1. parse_spec → Criar spec a partir de PRD
2. add_task (múltiplas) → Criar tasks baseado na spec
3. expand_task → Detalhar tasks complexas
4. next_task → Ver o que fazer primeiro
5. consult_council → Decisões arquiteturais
6. Implementar passo a passo
7. set_task_status → Marcar progresso
```

### Para Refactoring:
```
1. consult_council → "Qual a melhor abordagem para refatorar X?"
2. Analisar resposta do juiz
3. Implementar mudanças
4. consult_council → Revisar resultado (se complexo)
```

### Para Debugging:
```
1. solve_with_voting → Hipóteses sobre causa
2. Se não resolver: consult_council com mais contexto
3. Implementar fix
```

---

## 📊 ARMAZENAMENTO

As specs e tasks são salvas em arquivos JSON no workspace:

```
workspace/
└── .maker/
    ├── specs.json    # Especificações do projeto
    └── tasks.json    # Tasks e subtasks
```

---

## ⏱️ PERFORMANCE

### Tempos Esperados:
- `solve_with_voting`: 5-15 segundos
- `consult_council` (3 voters): 20-60 segundos
- `consult_council` (5 voters): 40-90 segundos
- `decompose_task`: 10-30 segundos
- `parse_spec`: 10-30 segundos
- `expand_task`: 10-30 segundos
- `list_tasks`, `get_task`, `next_task`: <1 segundo

---

## 🛡️ SEGURANÇA

### Nunca inclua na query:
- API keys ou secrets
- Senhas ou tokens
- Dados pessoais de usuários reais
- Informações confidenciais do negócio

### Ao consultar sobre código de segurança:
- Use dados fictícios nos exemplos
- Mencione que é código de segurança
- Peça validação de vulnerabilidades conhecidas

---

## � CHECKLIST PRÉ-IMPLEMENTAÇÃO

Antes de implementar qualquer mudança significativa, pergunte-se:

- [ ] Tenho uma spec clara? → **USE parse_spec**
- [ ] A task é complexa? → **USE decompose_task ou expand_task**
- [ ] É uma decisão arquitetural? → **USE consult_council**
- [ ] Afeta múltiplos arquivos? → **USE consult_council**
- [ ] É código de segurança/pagamento? → **USE consult_council (num_voters=5)**
- [ ] Tenho dúvida entre abordagens? → **USE consult_council**
- [ ] É um bug difícil? → **USE solve_with_voting**

**Se respondeu SIM a qualquer item: USE O MAKER-COUNCIL!**

---

## 📋 LISTA COMPLETA DE FERRAMENTAS (14)

| Categoria | Ferramenta | Descrição |
|-----------|------------|-----------|
| **Core** | `query` | API unificada com roteamento automático |
| **Core** | `consult_council` | Consulta com voting + juiz |
| **Core** | `solve_with_voting` | Consenso por votação |
| **Core** | `decompose_task` | Decompõe task em steps |
| **Core** | `senior_code_review` | Review profundo de código |
| **Specs** | `parse_spec` | Parseia PRD → spec estruturada |
| **Specs** | `get_spec` | Retorna spec atual/por ID |
| **Specs** | `update_spec` | Atualiza spec existente |
| **Tasks** | `list_tasks` | Lista todas as tasks |
| **Tasks** | `get_task` | Detalhes de uma task |
| **Tasks** | `next_task` | Próxima task disponível |
| **Tasks** | `add_task` | Cria nova task |
| **Tasks** | `set_task_status` | Atualiza status |
| **Tasks** | `expand_task` | Expande task em subtasks |

---

Mantenha estas regras visíveis durante o desenvolvimento! 🚀