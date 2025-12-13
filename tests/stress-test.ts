#!/usr/bin/env npx tsx
/**
 * MAKER-Council Stress Test
 * 
 * Teste de alto desempenho para requisições em paralelo com:
 * - Pool de concorrência controlada
 * - Tool calling (function calling)
 * - Métricas de performance (latência, throughput, erros)
 * - Suporte a streaming
 * - Tratamento robusto de erros
 */

import OpenAI from "openai";
import type { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

interface TestConfig {
  baseUrl: string;
  apiKey: string;
  models: string[];
  concurrency: number;
  requestsPerModel: number;
  timeoutMs: number;
  enableStreaming: boolean;
  enableToolCalling: boolean;
}

const DEFAULT_CONFIG: TestConfig = {
  baseUrl: process.env.MAKER_BASE_URL || "http://localhost:8317/v1",
  apiKey: process.env.MAKER_API_KEY || "dummy",
  models: [
    // Google models
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-pro-preview",
    "gemini-2.5-flash-lite",
    // Antigravity models (hybrid)
    "gemini-claude-sonnet-4-5-thinking",
    "gemini-claude-opus-4-5-thinking",
    "gemini-claude-sonnet-4-5",
    "gpt-oss-120b-medium",
    "gemini-2.5-computer-use-preview-10-2025",
    "gemini-3-pro-image-preview",
  ],
  concurrency: 10,
  requestsPerModel: 5,
  timeoutMs: 120000, // 2 minutos para modelos mais lentos
  enableStreaming: true,
  enableToolCalling: true,
};

// ============================================================================
// TIPOS
// ============================================================================

interface RequestResult {
  model: string;
  requestId: number;
  success: boolean;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  error?: string;
  toolCalls?: number;
  streaming: boolean;
}

interface ModelMetrics {
  model: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  totalTokensIn: number;
  totalTokensOut: number;
  throughputRps: number;
  errorRate: number;
  toolCallsTotal: number;
}

interface TestReport {
  startTime: Date;
  endTime: Date;
  totalDurationMs: number;
  config: TestConfig;
  modelMetrics: ModelMetrics[];
  overallMetrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    avgLatencyMs: number;
    overallThroughputRps: number;
    overallErrorRate: number;
  };
  errors: Array<{ model: string; error: string; count: number }>;
}

// ============================================================================
// FERRAMENTAS PARA TOOL CALLING
// ============================================================================

const TEST_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Obtém informações meteorológicas para uma cidade",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "Nome da cidade",
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "Unidade de temperatura",
          },
        },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Realiza cálculos matemáticos",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Expressão matemática a ser calculada",
          },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_database",
      description: "Busca informações em um banco de dados",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Query de busca",
          },
          limit: {
            type: "number",
            description: "Limite de resultados",
          },
        },
        required: ["query"],
      },
    },
  },
];

// Simula execução de ferramentas
function executeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "get_weather":
      return JSON.stringify({
        city: args.city,
        temperature: Math.floor(Math.random() * 35) + 5,
        unit: args.unit || "celsius",
        condition: ["sunny", "cloudy", "rainy", "windy"][Math.floor(Math.random() * 4)],
      });
    case "calculate":
      try {
        // Avaliação segura de expressões simples
        const expr = String(args.expression).replace(/[^0-9+\-*/().]/g, "");
        const result = Function(`"use strict"; return (${expr})`)();
        return JSON.stringify({ result });
      } catch {
        return JSON.stringify({ error: "Invalid expression" });
      }
    case "search_database":
      return JSON.stringify({
        results: [
          { id: 1, title: "Result 1", score: 0.95 },
          { id: 2, title: "Result 2", score: 0.87 },
        ],
        total: 2,
      });
    default:
      return JSON.stringify({ error: "Unknown tool" });
  }
}

// ============================================================================
// PROMPTS DE TESTE
// ============================================================================

const TEST_PROMPTS = [
  // Prompts simples
  "Explique brevemente o que é machine learning em 2 frases.",
  "Qual é a capital do Brasil?",
  "Liste 3 linguagens de programação populares.",
  
  // Prompts que podem triggerar tool calling
  "Qual é o clima em São Paulo hoje?",
  "Calcule 15 * 23 + 47",
  "Busque informações sobre inteligência artificial no banco de dados.",
  
  // Prompts complexos
  "Escreva uma função Python que ordena uma lista usando quicksort.",
  "Compare REST e GraphQL em termos de performance e flexibilidade.",
  "Explique o padrão de design Observer com um exemplo em TypeScript.",
];

// ============================================================================
// POOL DE CONCORRÊNCIA
// ============================================================================

class ConcurrencyPool {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ============================================================================
// CLIENTE DE TESTE
// ============================================================================

class StressTestClient {
  private client: OpenAI;
  private pool: ConcurrencyPool;
  private results: RequestResult[] = [];

  constructor(private config: TestConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs,
    });
    this.pool = new ConcurrencyPool(config.concurrency);
  }

  private getRandomPrompt(): string {
    return TEST_PROMPTS[Math.floor(Math.random() * TEST_PROMPTS.length)];
  }

  private async makeRequest(
    model: string,
    requestId: number,
    useStreaming: boolean,
    useTools: boolean
  ): Promise<RequestResult> {
    const startTime = Date.now();
    const prompt = this.getRandomPrompt();

    try {
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: "Você é um assistente útil e conciso." },
        { role: "user", content: prompt },
      ];

      if (useStreaming) {
        return await this.makeStreamingRequest(model, requestId, messages, useTools, startTime);
      } else {
        return await this.makeNonStreamingRequest(model, requestId, messages, useTools, startTime);
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      return {
        model,
        requestId,
        success: false,
        latencyMs,
        error: error instanceof Error ? error.message : String(error),
        streaming: useStreaming,
      };
    }
  }

  private async makeNonStreamingRequest(
    model: string,
    requestId: number,
    messages: ChatCompletionMessageParam[],
    useTools: boolean,
    startTime: number
  ): Promise<RequestResult> {
    let toolCallsCount = 0;
    let currentMessages = [...messages];

    // Loop para processar tool calls
    for (let iteration = 0; iteration < 5; iteration++) {
      const response = await this.client.chat.completions.create({
        model,
        messages: currentMessages,
        max_tokens: 1024,
        temperature: 0.7,
        ...(useTools && { tools: TEST_TOOLS, tool_choice: "auto" }),
      });

      const choice = response.choices[0];
      const message = choice.message;

      // Verificar se há tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        toolCallsCount += message.tool_calls.length;
        
        // Adicionar resposta do assistente
        currentMessages.push({
          role: "assistant",
          content: message.content || null,
          tool_calls: message.tool_calls,
        });

        // Executar cada tool call e adicionar resultado
        for (const toolCall of message.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments || "{}");
          const result = executeToolCall(toolCall.function.name, args);
          
          currentMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      } else {
        // Resposta final sem tool calls
        const latencyMs = Date.now() - startTime;
        return {
          model,
          requestId,
          success: true,
          latencyMs,
          tokensIn: response.usage?.prompt_tokens,
          tokensOut: response.usage?.completion_tokens,
          toolCalls: toolCallsCount,
          streaming: false,
        };
      }
    }

    // Máximo de iterações atingido
    const latencyMs = Date.now() - startTime;
    return {
      model,
      requestId,
      success: true,
      latencyMs,
      toolCalls: toolCallsCount,
      streaming: false,
    };
  }

  private async makeStreamingRequest(
    model: string,
    requestId: number,
    messages: ChatCompletionMessageParam[],
    useTools: boolean,
    startTime: number
  ): Promise<RequestResult> {
    let tokensOut = 0;
    let toolCallsCount = 0;
    let currentMessages = [...messages];

    // Loop para processar tool calls com streaming
    for (let iteration = 0; iteration < 5; iteration++) {
      const stream = await this.client.chat.completions.create({
        model,
        messages: currentMessages,
        max_tokens: 1024,
        temperature: 0.7,
        stream: true,
        ...(useTools && { tools: TEST_TOOLS, tool_choice: "auto" }),
      });

      let fullContent = "";
      const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let hasToolCalls = false;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        if (delta?.content) {
          fullContent += delta.content;
          tokensOut++;
        }

        if (delta?.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            const existing = toolCalls.get(tc.index) || { id: "", name: "", arguments: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            toolCalls.set(tc.index, existing);
          }
        }
      }

      if (hasToolCalls && toolCalls.size > 0) {
        toolCallsCount += toolCalls.size;
        
        // Converter tool calls para formato correto
        const toolCallsArray = Array.from(toolCalls.values()).map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));

        currentMessages.push({
          role: "assistant",
          content: fullContent || null,
          tool_calls: toolCallsArray,
        });

        // Executar cada tool call
        for (const tc of toolCallsArray) {
          const args = JSON.parse(tc.function.arguments || "{}");
          const result = executeToolCall(tc.function.name, args);
          
          currentMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }
      } else {
        // Resposta final
        const latencyMs = Date.now() - startTime;
        return {
          model,
          requestId,
          success: true,
          latencyMs,
          tokensOut,
          toolCalls: toolCallsCount,
          streaming: true,
        };
      }
    }

    const latencyMs = Date.now() - startTime;
    return {
      model,
      requestId,
      success: true,
      latencyMs,
      tokensOut,
      toolCalls: toolCallsCount,
      streaming: true,
    };
  }

  async runTest(): Promise<RequestResult[]> {
    const tasks: Promise<RequestResult>[] = [];

    for (const model of this.config.models) {
      for (let i = 0; i < this.config.requestsPerModel; i++) {
        // Alternar entre streaming e non-streaming
        const useStreaming = this.config.enableStreaming && i % 2 === 0;
        // Alternar entre com e sem tools
        const useTools = this.config.enableToolCalling && i % 3 === 0;

        tasks.push(
          this.pool.run(() => this.makeRequest(model, i, useStreaming, useTools))
        );
      }
    }

    // Usar Promise.allSettled para capturar todos os resultados
    const settled = await Promise.allSettled(tasks);
    
    this.results = settled.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        // Falha na Promise
        const modelIndex = Math.floor(index / this.config.requestsPerModel);
        const requestId = index % this.config.requestsPerModel;
        return {
          model: this.config.models[modelIndex] || "unknown",
          requestId,
          success: false,
          latencyMs: 0,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          streaming: false,
        };
      }
    });

    return this.results;
  }

  getResults(): RequestResult[] {
    return this.results;
  }
}

// ============================================================================
// GERAÇÃO DE RELATÓRIO
// ============================================================================

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function generateReport(
  results: RequestResult[],
  config: TestConfig,
  startTime: Date,
  endTime: Date
): TestReport {
  const totalDurationMs = endTime.getTime() - startTime.getTime();
  
  // Agrupar resultados por modelo
  const resultsByModel = new Map<string, RequestResult[]>();
  for (const result of results) {
    const existing = resultsByModel.get(result.model) || [];
    existing.push(result);
    resultsByModel.set(result.model, existing);
  }

  // Calcular métricas por modelo
  const modelMetrics: ModelMetrics[] = [];
  for (const [model, modelResults] of resultsByModel) {
    const successful = modelResults.filter((r) => r.success);
    const failed = modelResults.filter((r) => !r.success);
    const latencies = successful.map((r) => r.latencyMs);
    
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    modelMetrics.push({
      model,
      totalRequests: modelResults.length,
      successfulRequests: successful.length,
      failedRequests: failed.length,
      avgLatencyMs: avgLatency,
      minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : 0,
      maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
      p50LatencyMs: calculatePercentile(latencies, 50),
      p95LatencyMs: calculatePercentile(latencies, 95),
      p99LatencyMs: calculatePercentile(latencies, 99),
      totalTokensIn: successful.reduce((sum, r) => sum + (r.tokensIn || 0), 0),
      totalTokensOut: successful.reduce((sum, r) => sum + (r.tokensOut || 0), 0),
      throughputRps: successful.length / (totalDurationMs / 1000),
      errorRate: modelResults.length > 0 ? failed.length / modelResults.length : 0,
      toolCallsTotal: successful.reduce((sum, r) => sum + (r.toolCalls || 0), 0),
    });
  }

  // Agregar erros
  const errorCounts = new Map<string, Map<string, number>>();
  for (const result of results) {
    if (!result.success && result.error) {
      const modelErrors = errorCounts.get(result.model) || new Map();
      modelErrors.set(result.error, (modelErrors.get(result.error) || 0) + 1);
      errorCounts.set(result.model, modelErrors);
    }
  }

  const errors: Array<{ model: string; error: string; count: number }> = [];
  for (const [model, modelErrors] of errorCounts) {
    for (const [error, count] of modelErrors) {
      errors.push({ model, error, count });
    }
  }
  errors.sort((a, b) => b.count - a.count);

  // Métricas gerais
  const allSuccessful = results.filter((r) => r.success);
  const allFailed = results.filter((r) => !r.success);
  const allLatencies = allSuccessful.map((r) => r.latencyMs);

  return {
    startTime,
    endTime,
    totalDurationMs,
    config,
    modelMetrics,
    overallMetrics: {
      totalRequests: results.length,
      successfulRequests: allSuccessful.length,
      failedRequests: allFailed.length,
      avgLatencyMs: allLatencies.length > 0
        ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
        : 0,
      overallThroughputRps: allSuccessful.length / (totalDurationMs / 1000),
      overallErrorRate: results.length > 0 ? allFailed.length / results.length : 0,
    },
    errors,
  };
}

function formatReport(report: TestReport): string {
  const lines: string[] = [];
  
  lines.push("═".repeat(80));
  lines.push("                    MAKER-COUNCIL STRESS TEST REPORT");
  lines.push("═".repeat(80));
  lines.push("");
  
  // Configuração
  lines.push("📋 CONFIGURAÇÃO");
  lines.push("─".repeat(40));
  lines.push(`  Base URL: ${report.config.baseUrl}`);
  lines.push(`  Concorrência: ${report.config.concurrency}`);
  lines.push(`  Requests por modelo: ${report.config.requestsPerModel}`);
  lines.push(`  Modelos testados: ${report.config.models.length}`);
  lines.push(`  Streaming: ${report.config.enableStreaming ? "✅" : "❌"}`);
  lines.push(`  Tool Calling: ${report.config.enableToolCalling ? "✅" : "❌"}`);
  lines.push("");
  
  // Tempo
  lines.push("⏱️ TEMPO");
  lines.push("─".repeat(40));
  lines.push(`  Início: ${report.startTime.toISOString()}`);
  lines.push(`  Fim: ${report.endTime.toISOString()}`);
  lines.push(`  Duração total: ${(report.totalDurationMs / 1000).toFixed(2)}s`);
  lines.push("");
  
  // Métricas gerais
  lines.push("📊 MÉTRICAS GERAIS");
  lines.push("─".repeat(40));
  lines.push(`  Total de requisições: ${report.overallMetrics.totalRequests}`);
  lines.push(`  Sucesso: ${report.overallMetrics.successfulRequests} (${((1 - report.overallMetrics.overallErrorRate) * 100).toFixed(1)}%)`);
  lines.push(`  Falhas: ${report.overallMetrics.failedRequests} (${(report.overallMetrics.overallErrorRate * 100).toFixed(1)}%)`);
  lines.push(`  Latência média: ${report.overallMetrics.avgLatencyMs.toFixed(0)}ms`);
  lines.push(`  Throughput: ${report.overallMetrics.overallThroughputRps.toFixed(2)} req/s`);
  lines.push("");
  
  // Métricas por modelo
  lines.push("🤖 MÉTRICAS POR MODELO");
  lines.push("─".repeat(80));
  lines.push("");
  
  // Header da tabela
  const header = [
    "Modelo".padEnd(35),
    "OK".padStart(4),
    "Err".padStart(4),
    "Avg(ms)".padStart(8),
    "P50".padStart(7),
    "P95".padStart(7),
    "P99".padStart(7),
    "Tools".padStart(6),
  ].join(" │ ");
  
  lines.push("  " + header);
  lines.push("  " + "─".repeat(header.length));
  
  for (const m of report.modelMetrics.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)) {
    const row = [
      m.model.substring(0, 35).padEnd(35),
      m.successfulRequests.toString().padStart(4),
      m.failedRequests.toString().padStart(4),
      m.avgLatencyMs.toFixed(0).padStart(8),
      m.p50LatencyMs.toFixed(0).padStart(7),
      m.p95LatencyMs.toFixed(0).padStart(7),
      m.p99LatencyMs.toFixed(0).padStart(7),
      m.toolCallsTotal.toString().padStart(6),
    ].join(" │ ");
    lines.push("  " + row);
  }
  
  lines.push("");
  
  // Erros
  if (report.errors.length > 0) {
    lines.push("❌ ERROS");
    lines.push("─".repeat(40));
    for (const err of report.errors.slice(0, 10)) {
      lines.push(`  [${err.model}] (${err.count}x) ${err.error.substring(0, 60)}`);
    }
    if (report.errors.length > 10) {
      lines.push(`  ... e mais ${report.errors.length - 10} tipos de erros`);
    }
    lines.push("");
  }
  
  lines.push("═".repeat(80));
  
  return lines.join("\n");
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("🚀 Iniciando MAKER-Council Stress Test...\n");
  
  // Parse argumentos
  const args = process.argv.slice(2);
  const getArg = (name: string, defaultValue: string): string => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.split("=")[1] : defaultValue;
  };
  
  const config: TestConfig = {
    ...DEFAULT_CONFIG,
    baseUrl: getArg("base-url", DEFAULT_CONFIG.baseUrl),
    apiKey: getArg("api-key", DEFAULT_CONFIG.apiKey),
    concurrency: parseInt(getArg("concurrency", String(DEFAULT_CONFIG.concurrency))),
    requestsPerModel: parseInt(getArg("requests", String(DEFAULT_CONFIG.requestsPerModel))),
    timeoutMs: parseInt(getArg("timeout", String(DEFAULT_CONFIG.timeoutMs))),
    enableStreaming: getArg("streaming", "true") === "true",
    enableToolCalling: getArg("tools", "true") === "true",
  };
  
  // Filtrar modelos se especificado
  const modelsArg = getArg("models", "");
  if (modelsArg) {
    config.models = modelsArg.split(",").map((m) => m.trim());
  }
  
  if (!config.apiKey) {
    console.error("❌ Erro: API key não configurada.");
    console.error("   Use --api-key=... ou defina MAKER_API_KEY");
    process.exit(1);
  }
  
  console.log(`📋 Configuração:`);
  console.log(`   - Base URL: ${config.baseUrl}`);
  console.log(`   - Modelos: ${config.models.length}`);
  console.log(`   - Concorrência: ${config.concurrency}`);
  console.log(`   - Requests/modelo: ${config.requestsPerModel}`);
  console.log(`   - Total de requests: ${config.models.length * config.requestsPerModel}`);
  console.log(`   - Streaming: ${config.enableStreaming}`);
  console.log(`   - Tool Calling: ${config.enableToolCalling}`);
  console.log("");
  
  const client = new StressTestClient(config);
  const startTime = new Date();
  
  console.log("⏳ Executando testes...\n");
  
  // Progress tracking
  let completed = 0;
  const total = config.models.length * config.requestsPerModel;
  const progressInterval = setInterval(() => {
    const results = client.getResults();
    completed = results.length;
    const percent = ((completed / total) * 100).toFixed(1);
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    process.stdout.write(`\r   Progresso: ${completed}/${total} (${percent}%) | ✅ ${successful} | ❌ ${failed}`);
  }, 500);
  
  try {
    const results = await client.runTest();
    clearInterval(progressInterval);
    console.log("\n");
    
    const endTime = new Date();
    const report = generateReport(results, config, startTime, endTime);
    
    console.log(formatReport(report));
    
    // Salvar relatório JSON
    const jsonReport = JSON.stringify(report, null, 2);
    const reportPath = `stress-test-report-${startTime.toISOString().replace(/[:.]/g, "-")}.json`;
    
    await import("fs").then((fs) => {
      fs.writeFileSync(reportPath, jsonReport);
      console.log(`\n📁 Relatório JSON salvo em: ${reportPath}`);
    });
    
  } catch (error) {
    clearInterval(progressInterval);
    console.error("\n❌ Erro durante execução:", error);
    process.exit(1);
  }
}

main().catch(console.error);