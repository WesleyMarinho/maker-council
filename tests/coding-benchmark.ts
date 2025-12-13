#!/usr/bin/env npx tsx
/**
 * MAKER-Council Coding Benchmark
 * 
 * Avalia modelos em tarefas de codificação reais:
 * - Geração de código
 * - Correção de bugs
 * - Refatoração
 * - Fidelidade às instruções
 */

import OpenAI from "openai";

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

interface BenchmarkConfig {
  baseUrl: string;
  apiKey: string;
  models: string[];
  timeoutMs: number;
}

const CONFIG: BenchmarkConfig = {
  baseUrl: process.env.MAKER_BASE_URL || "http://localhost:8317/v1",
  apiKey: process.env.MAKER_API_KEY || "dummy",
  models: [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-pro-preview",
    "gemini-2.5-flash-lite",
    "gemini-claude-sonnet-4-5-thinking",
    "gemini-claude-opus-4-5-thinking",
    "gemini-claude-sonnet-4-5",
    "gpt-oss-120b-medium",
  ],
  timeoutMs: 180000, // 3 minutos
};

// ============================================================================
// TIPOS
// ============================================================================

interface CodingTask {
  id: string;
  name: string;
  category: "generation" | "bugfix" | "refactor" | "instruction_following";
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  expectedPatterns: RegExp[]; // Padrões que devem estar presentes
  forbiddenPatterns?: RegExp[]; // Padrões que NÃO devem estar presentes
  testCases?: Array<{ input: string; expectedOutput: string }>;
  maxTokens: number;
}

interface TaskResult {
  model: string;
  taskId: string;
  success: boolean;
  latencyMs: number;
  response: string;
  scores: {
    patternMatch: number; // 0-100: % de padrões esperados encontrados
    noForbidden: number; // 0-100: 100 se nenhum padrão proibido, 0 se algum
    codeQuality: number; // 0-100: avaliação heurística
    instructionFollowing: number; // 0-100: seguiu instruções
  };
  totalScore: number;
  errors?: string[];
}

interface ModelBenchmark {
  model: string;
  totalTasks: number;
  successfulTasks: number;
  avgLatencyMs: number;
  avgScore: number;
  categoryScores: Record<string, number>;
  difficultyScores: Record<string, number>;
}

// ============================================================================
// TAREFAS DE BENCHMARK
// ============================================================================

const CODING_TASKS: CodingTask[] = [
  // === GERAÇÃO DE CÓDIGO ===
  {
    id: "gen-001",
    name: "Implementar função de ordenação",
    category: "generation",
    difficulty: "easy",
    prompt: `Implemente uma função em TypeScript chamada \`quickSort\` que ordena um array de números.
    
Requisitos:
1. Use o algoritmo QuickSort
2. A função deve ser pura (não modificar o array original)
3. Retorne um novo array ordenado
4. Inclua tipagem TypeScript correta

Retorne APENAS o código, sem explicações.`,
    expectedPatterns: [
      /function\s+quickSort/,
      /number\[\]/,
      /pivot/i,
      /return/,
      /\[\.\.\./, // spread operator para não modificar original
    ],
    forbiddenPatterns: [
      /\.sort\(/,  // não deve usar sort nativo
    ],
    maxTokens: 1024,
  },
  {
    id: "gen-002",
    name: "Implementar classe de cache LRU",
    category: "generation",
    difficulty: "medium",
    prompt: `Implemente uma classe TypeScript chamada \`LRUCache\` (Least Recently Used).

Requisitos:
1. Constructor recebe capacidade máxima
2. Método \`get(key: string): T | undefined\` - retorna valor ou undefined
3. Método \`put(key: string, value: T): void\` - insere/atualiza valor
4. Quando capacidade é excedida, remove o item menos recentemente usado
5. Use generics para o tipo do valor

Retorne APENAS o código TypeScript, sem explicações.`,
    expectedPatterns: [
      /class\s+LRUCache/,
      /<T>/,
      /get\s*\(/,
      /put\s*\(/,
      /capacity/i,
      /Map|Object/,
    ],
    maxTokens: 1500,
  },
  {
    id: "gen-003",
    name: "Implementar debounce com TypeScript",
    category: "generation",
    difficulty: "medium",
    prompt: `Implemente uma função \`debounce\` em TypeScript com tipagem genérica correta.

Requisitos:
1. Aceita qualquer função como primeiro argumento
2. Aceita delay em ms como segundo argumento
3. Retorna uma nova função com a mesma assinatura
4. Preserva o tipo de retorno e parâmetros da função original
5. Inclua tipagem TypeScript completa usando generics

Retorne APENAS o código, sem explicações.`,
    expectedPatterns: [
      /function\s+debounce/,
      /setTimeout/,
      /clearTimeout/,
      /<.*>/,  // generics
      /\.\.\./,  // rest/spread
    ],
    maxTokens: 1024,
  },

  // === CORREÇÃO DE BUGS ===
  {
    id: "bug-001",
    name: "Corrigir bug de closure em loop",
    category: "bugfix",
    difficulty: "easy",
    prompt: `O código abaixo tem um bug clássico de closure em loop. Corrija-o.

\`\`\`typescript
function createCounters(n: number): (() => number)[] {
  const counters: (() => number)[] = [];
  for (var i = 0; i < n; i++) {
    counters.push(function() {
      return i;
    });
  }
  return counters;
}

// Problema: todos os counters retornam o mesmo valor (n)
\`\`\`

Retorne APENAS o código corrigido, sem explicações.`,
    expectedPatterns: [
      /let\s+i|const\s+i|\(i\)|\.forEach|\.map/,  // deve usar let, const, ou IIFE/closure
    ],
    forbiddenPatterns: [
      /var\s+i\s*=/,  // não deve usar var
    ],
    maxTokens: 512,
  },
  {
    id: "bug-002",
    name: "Corrigir race condition em async",
    category: "bugfix",
    difficulty: "hard",
    prompt: `O código abaixo tem uma race condition. Corrija-o para garantir que as operações sejam thread-safe.

\`\`\`typescript
class Counter {
  private value = 0;

  async increment(): Promise<number> {
    const current = this.value;
    await this.delay(10); // simula operação async
    this.value = current + 1;
    return this.value;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Problema: múltiplas chamadas simultâneas a increment() causam valores incorretos
\`\`\`

Retorne APENAS o código corrigido usando mutex/lock ou queue, sem explicações.`,
    expectedPatterns: [
      /mutex|lock|queue|semaphore|pending|promise/i,
      /await/,
    ],
    maxTokens: 1024,
  },

  // === REFATORAÇÃO ===
  {
    id: "ref-001",
    name: "Refatorar para padrão Strategy",
    category: "refactor",
    difficulty: "medium",
    prompt: `Refatore o código abaixo para usar o padrão Strategy:

\`\`\`typescript
class PaymentProcessor {
  processPayment(amount: number, method: string): string {
    if (method === 'credit') {
      // lógica de cartão de crédito
      return \`Processando \${amount} via cartão de crédito\`;
    } else if (method === 'debit') {
      // lógica de débito
      return \`Processando \${amount} via débito\`;
    } else if (method === 'pix') {
      // lógica de PIX
      return \`Processando \${amount} via PIX\`;
    } else {
      throw new Error('Método não suportado');
    }
  }
}
\`\`\`

Requisitos:
1. Crie uma interface PaymentStrategy
2. Implemente estratégias separadas para cada método
3. O PaymentProcessor deve receber a estratégia

Retorne APENAS o código refatorado, sem explicações.`,
    expectedPatterns: [
      /interface\s+PaymentStrategy|type\s+PaymentStrategy/,
      /class\s+.*Strategy/,
      /implements\s+PaymentStrategy/,
    ],
    forbiddenPatterns: [
      /if\s*\(\s*method\s*===|switch\s*\(\s*method/,  // não deve ter if/switch no método
    ],
    maxTokens: 1500,
  },

  // === SEGUIR INSTRUÇÕES ===
  {
    id: "inst-001",
    name: "Seguir especificação exata de API",
    category: "instruction_following",
    difficulty: "hard",
    prompt: `Implemente uma função que siga EXATAMENTE esta especificação:

Nome: \`parseUserInput\`
Parâmetros:
  - input: string - entrada do usuário
  - options: objeto com:
    - trim: boolean (default: true) - remove espaços
    - lowercase: boolean (default: false) - converte para minúsculas
    - maxLength: number (default: 100) - trunca se exceder

Retorno: objeto com:
  - value: string - valor processado
  - original: string - valor original
  - truncated: boolean - true se foi truncado
  - length: number - comprimento final

Regras:
1. Aplicar transformações na ordem: trim -> lowercase -> truncate
2. Se input for null/undefined, retornar value como string vazia
3. Usar exatamente os nomes especificados

Retorne APENAS o código TypeScript, sem explicações.`,
    expectedPatterns: [
      /parseUserInput/,
      /trim/,
      /lowercase/,
      /maxLength/,
      /value.*:.*string/,
      /original.*:.*string/,
      /truncated.*:.*boolean/,
      /length.*:.*number/,
    ],
    maxTokens: 1024,
  },
  {
    id: "inst-002",
    name: "Implementar validador com regras específicas",
    category: "instruction_following",
    difficulty: "medium",
    prompt: `Implemente um validador de senha que siga EXATAMENTE estas regras:

Função: \`validatePassword(password: string): ValidationResult\`

Regras de validação (TODAS devem ser verificadas):
1. Mínimo 8 caracteres
2. Máximo 128 caracteres
3. Pelo menos 1 letra maiúscula
4. Pelo menos 1 letra minúscula
5. Pelo menos 1 número
6. Pelo menos 1 caractere especial (!@#$%^&*()_+-=[]{}|;:,.<>?)
7. Não pode conter espaços

Tipo de retorno ValidationResult:
\`\`\`typescript
interface ValidationResult {
  valid: boolean;
  errors: string[]; // lista de mensagens de erro
}
\`\`\`

IMPORTANTE: 
- Use EXATAMENTE os nomes especificados
- Retorne TODAS as mensagens de erro aplicáveis, não apenas a primeira
- Mensagens devem ser descritivas

Retorne APENAS o código, sem explicações.`,
    expectedPatterns: [
      /validatePassword/,
      /ValidationResult/,
      /valid.*boolean/,
      /errors.*string\[\]/,
      /[A-Z]/,  // regex para maiúscula
      /[a-z]/,  // regex para minúscula
      /[0-9]|\d/,  // regex para número
    ],
    maxTokens: 1500,
  },
];

// ============================================================================
// AVALIAÇÃO
// ============================================================================

function evaluateResponse(task: CodingTask, response: string): TaskResult["scores"] {
  const scores = {
    patternMatch: 0,
    noForbidden: 100,
    codeQuality: 0,
    instructionFollowing: 0,
  };

  // 1. Verificar padrões esperados
  let matchedPatterns = 0;
  for (const pattern of task.expectedPatterns) {
    if (pattern.test(response)) {
      matchedPatterns++;
    }
  }
  scores.patternMatch = Math.round((matchedPatterns / task.expectedPatterns.length) * 100);

  // 2. Verificar padrões proibidos
  if (task.forbiddenPatterns) {
    for (const pattern of task.forbiddenPatterns) {
      if (pattern.test(response)) {
        scores.noForbidden = 0;
        break;
      }
    }
  }

  // 3. Avaliar qualidade do código (heurísticas)
  let qualityScore = 50; // base
  
  // Tem tipagem TypeScript?
  if (/:\s*(string|number|boolean|void|any|\w+\[\]|<.*>)/.test(response)) {
    qualityScore += 15;
  }
  
  // Tem tratamento de erros?
  if (/try\s*{|throw\s+new|\.catch\(|if\s*\(!?\w+\)/.test(response)) {
    qualityScore += 10;
  }
  
  // Código está bem formatado (tem indentação)?
  if (/\n\s{2,}/.test(response)) {
    qualityScore += 10;
  }
  
  // Usa const/let ao invés de var?
  if (/\b(const|let)\b/.test(response) && !/\bvar\b/.test(response)) {
    qualityScore += 10;
  }
  
  // Tem comentários úteis?
  if (/\/\/.*\w|\/\*[\s\S]*?\*\//.test(response)) {
    qualityScore += 5;
  }

  scores.codeQuality = Math.min(100, qualityScore);

  // 4. Avaliar seguimento de instruções
  let instructionScore = 50;
  
  // Retornou apenas código (sem explicações longas)?
  const codeBlockMatch = response.match(/```[\s\S]*?```/g);
  const hasOnlyCode = codeBlockMatch || response.split('\n').filter(l => l.trim() && !l.startsWith('//')).length < 50;
  if (hasOnlyCode) {
    instructionScore += 20;
  }
  
  // Usou os nomes corretos?
  const taskNameMatches = task.prompt.match(/`(\w+)`/g);
  if (taskNameMatches) {
    let namesFound = 0;
    for (const name of taskNameMatches) {
      const cleanName = name.replace(/`/g, '');
      if (response.includes(cleanName)) {
        namesFound++;
      }
    }
    instructionScore += Math.round((namesFound / taskNameMatches.length) * 30);
  } else {
    instructionScore += 30;
  }

  scores.instructionFollowing = Math.min(100, instructionScore);

  return scores;
}

function calculateTotalScore(scores: TaskResult["scores"]): number {
  // Pesos: patternMatch (30%), noForbidden (20%), codeQuality (25%), instructionFollowing (25%)
  return Math.round(
    scores.patternMatch * 0.30 +
    scores.noForbidden * 0.20 +
    scores.codeQuality * 0.25 +
    scores.instructionFollowing * 0.25
  );
}

// ============================================================================
// EXECUÇÃO
// ============================================================================

async function runTask(
  client: OpenAI,
  model: string,
  task: CodingTask
): Promise<TaskResult> {
  const startTime = Date.now();
  
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "Você é um programador expert em TypeScript. Responda apenas com código limpo e funcional.",
        },
        {
          role: "user",
          content: task.prompt,
        },
      ],
      max_tokens: task.maxTokens,
      temperature: 0.3, // Baixa temperatura para código mais consistente
    });

    const latencyMs = Date.now() - startTime;
    const content = response.choices[0]?.message?.content || "";
    
    const scores = evaluateResponse(task, content);
    const totalScore = calculateTotalScore(scores);

    return {
      model,
      taskId: task.id,
      success: true,
      latencyMs,
      response: content,
      scores,
      totalScore,
    };
  } catch (error) {
    return {
      model,
      taskId: task.id,
      success: false,
      latencyMs: Date.now() - startTime,
      response: "",
      scores: { patternMatch: 0, noForbidden: 0, codeQuality: 0, instructionFollowing: 0 },
      totalScore: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function runBenchmark(config: BenchmarkConfig): Promise<{
  results: TaskResult[];
  modelBenchmarks: ModelBenchmark[];
}> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
  });

  const results: TaskResult[] = [];
  const totalTests = config.models.length * CODING_TASKS.length;
  let completed = 0;

  console.log(`\n📝 Executando ${totalTests} testes (${config.models.length} modelos × ${CODING_TASKS.length} tarefas)\n`);

  for (const model of config.models) {
    console.log(`\n🤖 Testando: ${model}`);
    
    for (const task of CODING_TASKS) {
      process.stdout.write(`   [${task.category}] ${task.name}... `);
      
      const result = await runTask(client, model, task);
      results.push(result);
      completed++;
      
      if (result.success) {
        console.log(`✅ Score: ${result.totalScore}/100 (${result.latencyMs}ms)`);
      } else {
        console.log(`❌ Erro: ${result.errors?.[0]?.substring(0, 50)}`);
      }
    }
  }

  // Calcular métricas por modelo
  const modelBenchmarks: ModelBenchmark[] = [];
  
  for (const model of config.models) {
    const modelResults = results.filter(r => r.model === model);
    const successful = modelResults.filter(r => r.success);
    
    const categoryScores: Record<string, number[]> = {};
    const difficultyScores: Record<string, number[]> = {};
    
    for (const result of successful) {
      const task = CODING_TASKS.find(t => t.id === result.taskId)!;
      
      if (!categoryScores[task.category]) categoryScores[task.category] = [];
      categoryScores[task.category].push(result.totalScore);
      
      if (!difficultyScores[task.difficulty]) difficultyScores[task.difficulty] = [];
      difficultyScores[task.difficulty].push(result.totalScore);
    }
    
    const avgCategoryScores: Record<string, number> = {};
    for (const [cat, scores] of Object.entries(categoryScores)) {
      avgCategoryScores[cat] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
    
    const avgDifficultyScores: Record<string, number> = {};
    for (const [diff, scores] of Object.entries(difficultyScores)) {
      avgDifficultyScores[diff] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
    
    modelBenchmarks.push({
      model,
      totalTasks: modelResults.length,
      successfulTasks: successful.length,
      avgLatencyMs: successful.length > 0 
        ? Math.round(successful.reduce((sum, r) => sum + r.latencyMs, 0) / successful.length)
        : 0,
      avgScore: successful.length > 0
        ? Math.round(successful.reduce((sum, r) => sum + r.totalScore, 0) / successful.length)
        : 0,
      categoryScores: avgCategoryScores,
      difficultyScores: avgDifficultyScores,
    });
  }

  return { results, modelBenchmarks };
}

// ============================================================================
// RELATÓRIO
// ============================================================================

function printReport(modelBenchmarks: ModelBenchmark[]): void {
  console.log("\n" + "═".repeat(100));
  console.log("                           CODING BENCHMARK REPORT");
  console.log("═".repeat(100));

  // Ordenar por score médio
  const sorted = [...modelBenchmarks].sort((a, b) => b.avgScore - a.avgScore);

  console.log("\n🏆 RANKING GERAL (por Score Médio)\n");
  
  const header = [
    "#".padStart(2),
    "Modelo".padEnd(40),
    "Score".padStart(6),
    "Latência".padStart(10),
    "Gen".padStart(5),
    "Bug".padStart(5),
    "Ref".padStart(5),
    "Inst".padStart(5),
  ].join(" │ ");
  
  console.log(header);
  console.log("─".repeat(header.length));

  sorted.forEach((m, i) => {
    const row = [
      (i + 1).toString().padStart(2),
      m.model.substring(0, 40).padEnd(40),
      m.avgScore.toString().padStart(6),
      `${m.avgLatencyMs}ms`.padStart(10),
      (m.categoryScores.generation || 0).toString().padStart(5),
      (m.categoryScores.bugfix || 0).toString().padStart(5),
      (m.categoryScores.refactor || 0).toString().padStart(5),
      (m.categoryScores.instruction_following || 0).toString().padStart(5),
    ].join(" │ ");
    
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
    console.log(`${medal} ${row}`);
  });

  console.log("\n📊 ANÁLISE POR DIFICULDADE\n");
  
  const diffHeader = [
    "Modelo".padEnd(40),
    "Easy".padStart(6),
    "Medium".padStart(8),
    "Hard".padStart(6),
  ].join(" │ ");
  
  console.log(diffHeader);
  console.log("─".repeat(diffHeader.length));

  for (const m of sorted) {
    const row = [
      m.model.substring(0, 40).padEnd(40),
      (m.difficultyScores.easy || 0).toString().padStart(6),
      (m.difficultyScores.medium || 0).toString().padStart(8),
      (m.difficultyScores.hard || 0).toString().padStart(6),
    ].join(" │ ");
    console.log(row);
  }

  // Recomendações
  console.log("\n" + "═".repeat(100));
  console.log("📋 RECOMENDAÇÕES");
  console.log("═".repeat(100));

  const best = sorted[0];
  const fastest = [...sorted].sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];
  const bestBugfix = [...sorted].sort((a, b) => 
    (b.categoryScores.bugfix || 0) - (a.categoryScores.bugfix || 0)
  )[0];
  const bestInstructions = [...sorted].sort((a, b) => 
    (b.categoryScores.instruction_following || 0) - (a.categoryScores.instruction_following || 0)
  )[0];

  console.log(`\n🏆 Melhor Geral: ${best.model} (Score: ${best.avgScore})`);
  console.log(`⚡ Mais Rápido: ${fastest.model} (${fastest.avgLatencyMs}ms)`);
  console.log(`🐛 Melhor para Bugfix: ${bestBugfix.model} (Score: ${bestBugfix.categoryScores.bugfix || 0})`);
  console.log(`📋 Mais Fiel às Instruções: ${bestInstructions.model} (Score: ${bestInstructions.categoryScores.instruction_following || 0})`);

  console.log("\n" + "═".repeat(100));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("🚀 MAKER-Council Coding Benchmark\n");
  
  // Parse argumentos
  const args = process.argv.slice(2);
  const getArg = (name: string, defaultValue: string): string => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.split("=")[1] : defaultValue;
  };

  const config: BenchmarkConfig = {
    ...CONFIG,
    baseUrl: getArg("base-url", CONFIG.baseUrl),
    apiKey: getArg("api-key", CONFIG.apiKey),
  };

  // Filtrar modelos se especificado
  const modelsArg = getArg("models", "");
  if (modelsArg) {
    config.models = modelsArg.split(",").map((m) => m.trim());
  }

  console.log(`📋 Configuração:`);
  console.log(`   - Base URL: ${config.baseUrl}`);
  console.log(`   - Modelos: ${config.models.length}`);
  console.log(`   - Tarefas: ${CODING_TASKS.length}`);

  const startTime = Date.now();
  const { results, modelBenchmarks } = await runBenchmark(config);
  const totalTime = (Date.now() - startTime) / 1000;

  printReport(modelBenchmarks);

  console.log(`\n⏱️ Tempo total: ${totalTime.toFixed(1)}s`);

  // Salvar resultados
  const reportPath = `coding-benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await import("fs").then((fs) => {
    fs.writeFileSync(reportPath, JSON.stringify({ results, modelBenchmarks }, null, 2));
    console.log(`📁 Resultados salvos em: ${reportPath}`);
  });
}

main().catch(console.error);