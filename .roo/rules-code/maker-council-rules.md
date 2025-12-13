# Regras de Uso do MAKER-Council MCP

> **Versão:** 1.0 | **Atualizado:** 2024-12-12

---

## 🎯 QUANDO USAR O MAKER-COUNCIL

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

## 📋 FORMATO DE CONSULTA

### Para `consult_council`:

```xml
<use_mcp_tool>
<server_name>maker-council</server_name>
<tool_name>consult_council</tool_name>
<arguments>
{
  "query": "CONTEXTO:\n[Descreva o contexto do projeto/arquivo]\n\nPROBLEMA:\n[Descreva o problema específico]\n\nOPÇÕES CONSIDERADAS:\n1. [Opção A]\n2. [Opção B]\n\nCRITÉRIOS:\n- [O que é importante: performance, manutenibilidade, etc]",
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
  "task": "Implementar [funcionalidade] que deve:\n1. [Requisito 1]\n2. [Requisito 2]\n3. [Requisito 3]"
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
          const user = await db.users.findById(order.userId);
          await emailService.send(user.email, 'Order confirmed');
          await db.orders.update(orderId, { status: 'confirmed' });
        }
        ```"
```

### 4. Use decompose_task Antes de Tarefas Grandes
```
1. Primeiro: decompose_task para entender os passos
2. Depois: consult_council para decisões em cada passo
3. Por fim: Implementar seguindo o plano
```

---

## 🔄 WORKFLOW RECOMENDADO

### Para Features Novas:
```
1. decompose_task → Planejar implementação
2. consult_council → Decisões arquiteturais
3. Implementar passo a passo
4. solve_with_voting → Validar escolhas pontuais
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

## ⏱️ PERFORMANCE

### Tempos Esperados:
- `solve_with_voting`: 5-15 segundos
- `consult_council` (3 voters): 20-60 segundos
- `consult_council` (5 voters): 40-90 segundos
- `decompose_task`: 10-30 segundos

### Se demorar muito:
- Verifique se o servidor está respondendo
- Reduza num_voters para teste rápido
- Verifique timeout (configurado para 600s)

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

## 📊 INTERPRETANDO RESULTADOS

### Métricas do Relatório:
- **Total de amostras**: Quantas respostas foram geradas
- **Amostras válidas**: Respostas que passaram no red-flagging
- **Taxa de red-flag**: % de respostas descartadas (ideal < 20%)

### Seções da Decisão do Juiz:
1. **## Análise**: Resumo das propostas dos voters
2. **## Decisão**: Solução final sintetizada
3. **RED FLAG**: (se houver) Conflito perigoso detectado

---

## 🔧 TROUBLESHOOTING

### Erro "Timeout":
- Aumente timeout no mcp.json
- Reduza num_voters
- Simplifique a query

### Respostas inconsistentes:
- Adicione mais contexto
- Seja mais específico
- Use k maior (4 ou 5)

### "Nenhum microagente conseguiu gerar proposta":
- Query pode estar mal formatada
- Verifique conexão com API
- Tente com query mais simples primeiro