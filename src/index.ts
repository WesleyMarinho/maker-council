#!/usr/bin/env node
/**
 * MAKER-Council MCP Server
 * 
 * Implementação do paper "MAKER: Massively Decomposed Agentic Processes"
 * (arXiv:2511.09030v1)
 * 
 * MAKER = Maximal Agentic decomposition + first-to-ahead-by-K Error correction + Red-flagging
 * 
 * Componentes principais:
 * 1. MAD (Maximal Agentic Decomposition) - Decomposição em subtarefas mínimas
 * 2. First-to-ahead-by-k Voting - Sistema de votação com margem k
 * 3. Red-flagging - Descarte de respostas problemáticas
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

interface MakerConfig {
  apiKey: string;
  baseUrl: string;
  judgeModel: string;
  voterModel: string;
  k: number;
  maxTokens: number;
  maxRounds: number;
}

interface VotingState {
  votes: Map<string, number>;
  totalSamples: number;
  validSamples: number;
  redFlagged: number;
  elapsedTime: number;
}

interface RedFlagResult {
  isValid: boolean;
  reason?: string;
  content: string;
}

// ============================================================================
// CONFIGURAÇÃO (via argumentos de linha de comando ou variáveis de ambiente)
// ============================================================================

function getConfig(): MakerConfig {
  // Prioridade: args > env
  const args = process.argv.slice(2);
  const getArg = (name: string, envName: string, defaultValue: string): string => {
    const argIndex = args.findIndex(a => a.startsWith(`--${name}=`));
    if (argIndex !== -1) {
      return args[argIndex].split('=')[1];
    }
    return process.env[envName] || defaultValue;
  };

  return {
    apiKey: getArg('api-key', 'MAKER_API_KEY', ''),
    baseUrl: getArg('base-url', 'MAKER_BASE_URL', 'https://api.openai.com/v1'),
    judgeModel: getArg('judge-model', 'MAKER_JUDGE_MODEL', 'gpt-4'),
    voterModel: getArg('voter-model', 'MAKER_VOTER_MODEL', 'gpt-3.5-turbo'),
    k: parseInt(getArg('k', 'MAKER_K', '3')),
    maxTokens: parseInt(getArg('max-tokens', 'MAKER_MAX_TOKENS', '750')),
    maxRounds: parseInt(getArg('max-rounds', 'MAKER_MAX_ROUNDS', '50')),
  };
}

// ============================================================================
// CLIENTE LLM (OpenAI-compatible)
// ============================================================================

let openaiClient: OpenAI | null = null;

function getClient(config: MakerConfig): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }
  return openaiClient;
}

async function createMessage(
  config: MakerConfig,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
  maxTokens: number = 1024
): Promise<{ text: string; tokens: number }> {
  const client = getClient(config);
  
  try {
    console.error(`[MAKER] Chamando API: model=${model}, temp=${temperature}, maxTokens=${maxTokens}`);
    console.error(`[MAKER] Base URL: ${config.baseUrl}`);
    
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
    });

    console.error(`[MAKER] Resposta recebida: choices=${response.choices?.length || 0}`);
    
    // GLM-4.6 pode retornar reasoning_content separado do content
    const message = response.choices?.[0]?.message as any;
    let text = message?.content || "";
    const reasoningText = message?.reasoning_content || "";
    
    // Se há reasoning_content, combinar com content
    // Para decomposição de tarefas, o reasoning geralmente contém a análise e o content a resposta final
    if (reasoningText && text) {
      // Se ambos existem, preferir o content (resposta final)
      text = text;
    } else if (reasoningText && !text) {
      // Se só há reasoning, usar ele
      text = reasoningText;
    } else if (!reasoningText && !text) {
      // Se nenhum dos dois, tentar extrair de outras propriedades
      text = JSON.stringify(message);
    }
    
    const tokens = response.usage?.completion_tokens || Math.ceil(text.length / 4);
    
    console.error(`[MAKER] Texto extraído: ${text.substring(0, 100)}... (${tokens} tokens)`);
    console.error(`[MAKER] Has reasoning: ${!!reasoningText}, Has content: ${!!message?.content}`);
    
    return { text, tokens };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[MAKER] Erro na API: ${errorMessage}`);
    if (error instanceof Error && 'response' in error) {
      console.error(`[MAKER] Response details:`, JSON.stringify((error as any).response?.data || {}));
    }
    throw new Error(`Erro na API: ${errorMessage}`);
  }
}

// ============================================================================
// RED-FLAGGING (Seção 3.3 do paper)
// ============================================================================

function checkRedFlags(
  response: string,
  numTokens: number,
  maxTokens: number
): RedFlagResult {
  // Red flag 1: Resposta muito longa (indica over-analysis/confusão)
  if (numTokens > maxTokens) {
    return {
      isValid: false,
      reason: `Resposta muito longa (${numTokens} tokens > ${maxTokens})`,
      content: "",
    };
  }

  // Red flag 2: Resposta vazia
  if (!response.trim()) {
    return {
      isValid: false,
      reason: "Resposta vazia",
      content: "",
    };
  }

  return {
    isValid: true,
    content: response,
  };
}

// ============================================================================
// FIRST-TO-AHEAD-BY-K VOTING (Seção 3.2 do paper)
// ============================================================================

function extractAnswer(response: string): string {
  // Tentar extrair bloco de código
  const codeMatch = response.match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (codeMatch) {
    return codeMatch[1].trim();
  }

  // Tentar extrair resposta após marcadores comuns
  const markers = ["Resposta:", "Solução:", "Answer:", "Solution:", "Result:"];
  for (const marker of markers) {
    if (response.includes(marker)) {
      return response.split(marker)[1].trim();
    }
  }

  // Retornar resposta limpa
  return response.trim();
}

async function firstToAheadByKVoting(
  config: MakerConfig,
  prompt: string,
  systemPrompt: string,
  model: string,
  k: number = 3,
  temperature: number = 0.7
): Promise<{ winner: string; state: VotingState }> {
  const startTime = Date.now();
  const state: VotingState = {
    votes: new Map(),
    totalSamples: 0,
    validSamples: 0,
    redFlagged: 0,
    elapsedTime: 0,
  };

  // Primeira amostra determinística (temperature=0)
  try {
    const { text, tokens } = await createMessage(
      config,
      model,
      systemPrompt,
      prompt,
      0,
      config.maxTokens + 100
    );
    state.totalSamples++;

    const flagResult = checkRedFlags(text, tokens, config.maxTokens);
    if (flagResult.isValid) {
      const canonical = extractAnswer(text);
      if (canonical) {
        state.validSamples++;
        state.votes.set(canonical, (state.votes.get(canonical) || 0) + 1);

        // Verificar vitória imediata
        if (checkWinner(state.votes, canonical, k)) {
          state.elapsedTime = (Date.now() - startTime) / 1000;
          return { winner: canonical, state };
        }
      }
    } else {
      state.redFlagged++;
    }
  } catch {
    state.redFlagged++;
  }

  // Votação iterativa
  for (let round = 1; round < config.maxRounds; round++) {
    try {
      const { text, tokens } = await createMessage(
        config,
        model,
        systemPrompt,
        prompt,
        temperature,
        config.maxTokens + 100
      );
      state.totalSamples++;

      const flagResult = checkRedFlags(text, tokens, config.maxTokens);
      if (flagResult.isValid) {
        const canonical = extractAnswer(text);
        if (canonical) {
          state.validSamples++;
          state.votes.set(canonical, (state.votes.get(canonical) || 0) + 1);

          // Verificar vitória
          if (checkWinner(state.votes, canonical, k)) {
            state.elapsedTime = (Date.now() - startTime) / 1000;
            return { winner: canonical, state };
          }
        }
      } else {
        state.redFlagged++;
      }
    } catch {
      state.redFlagged++;
    }
  }

  state.elapsedTime = (Date.now() - startTime) / 1000;

  // Retornar mais votado se não convergiu
  let maxVotes = 0;
  let winner = "";
  for (const [candidate, votes] of state.votes) {
    if (votes > maxVotes) {
      maxVotes = votes;
      winner = candidate;
    }
  }

  return { winner, state };
}

function checkWinner(votes: Map<string, number>, candidate: string, k: number): boolean {
  const currentVotes = votes.get(candidate) || 0;
  let maxOtherVotes = 0;
  
  for (const [key, v] of votes) {
    if (key !== candidate && v > maxOtherVotes) {
      maxOtherVotes = v;
    }
  }

  return currentVotes >= k + maxOtherVotes;
}

// ============================================================================
// PROMPTS DO SISTEMA
// ============================================================================

const VOTER_SYSTEM_PROMPT = `Você é um microagente especializado focado em precisão técnica.
Sua tarefa é analisar a questão e fornecer UMA solução clara e concisa.

REGRAS:
1. Seja direto e técnico
2. Forneça apenas a solução, sem explicações longas
3. Se for código, forneça código funcional e completo
4. Não repita a pergunta nem faça preâmbulos

Responda de forma estruturada e objetiva.`;

const JUDGE_SYSTEM_PROMPT = `Você é o Juiz Sênior do MAKER-Council.
Sua função é analisar múltiplas propostas de microagentes e sintetizar a melhor solução.

PROCESSO DE JULGAMENTO:
1. CONSENSO: Se as propostas concordam, sintetize a melhor versão combinando pontos fortes
2. DIVERGÊNCIA MENOR: Escolha a abordagem mais robusta e justifique brevemente
3. DIVERGÊNCIA PERIGOSA: Se propostas são contraditórias de forma que pode causar bugs ou 
   problemas de segurança, retorne exatamente "RED FLAG:" seguido da explicação do conflito

FORMATO DA RESPOSTA:
- Comece com "## Análise" resumindo as propostas
- Depois "## Decisão" com a solução final
- Se código, forneça código completo e funcional`;

const DECOMPOSER_SYSTEM_PROMPT = `Você é um especialista em decomposição de tarefas seguindo a metodologia MAKER.
Sua função é quebrar tarefas complexas em passos ATÔMICOS e ACIONÁVEIS.

PRINCÍPIOS DA DECOMPOSIÇÃO MAKER:
1. Cada passo deve ser uma ÚNICA ação verificável
2. Passos devem ser pequenos o suficiente para um microagente executar sem confusão
3. Dependências entre passos devem ser explícitas
4. Evite passos vagos - seja específico sobre O QUE fazer

FORMATO DE SAÍDA (JSON):
{
    "task": "descrição original",
    "total_steps": número,
    "steps": [
        {
            "id": 1,
            "action": "ação específica",
            "input": "o que este passo recebe",
            "output": "o que este passo produz",
            "dependencies": []
        }
    ]
}`;

// ============================================================================
// FERRAMENTAS MCP
// ============================================================================

const tools: Tool[] = [
  {
    name: "consult_council",
    description: `Consulta o MAKER-Council usando o algoritmo completo do paper.

Processo:
1. Múltiplos microagentes (voters) geram propostas usando votação first-to-ahead-by-k
2. Um juiz sênior analisa as propostas e sintetiza o consenso
3. Red-flagging descarta respostas problemáticas automaticamente

Parâmetros:
- query: A questão ou código a ser analisado
- num_voters: Número de microagentes (padrão: 3)
- k: Margem de votação first-to-ahead-by-k (padrão: 3)`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A questão ou código a ser analisado" },
        num_voters: { type: "number", description: "Número de microagentes (1-10)", default: 3 },
        k: { type: "number", description: "Margem de votação (1-10)", default: 3 },
      },
      required: ["query"],
    },
  },
  {
    name: "solve_with_voting",
    description: `Resolve uma questão usando APENAS votação first-to-ahead-by-k (sem juiz).

Útil para questões com resposta objetiva onde o consenso estatístico é suficiente.
Mais rápido e barato que consult_council.

Parâmetros:
- query: A questão a ser resolvida
- k: Margem de votação (padrão: 3)`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A questão a ser resolvida" },
        k: { type: "number", description: "Margem de votação (1-10)", default: 3 },
      },
      required: ["query"],
    },
  },
  {
    name: "decompose_task",
    description: `Decompõe tarefas complexas em passos atômicos (MAD - Maximal Agentic Decomposition).

Segue a metodologia MAKER onde cada passo deve ser:
- Uma única ação verificável
- Pequeno o suficiente para um microagente executar sem confusão
- Com dependências explícitas

Retorna JSON com a decomposição estruturada.`,
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "A tarefa a ser decomposta" },
      },
      required: ["task"],
    },
  },
];

// ============================================================================
// HANDLERS DAS FERRAMENTAS
// ============================================================================

async function handleConsultCouncil(
  config: MakerConfig,
  query: string,
  numVoters: number = 3,
  k: number = 3
): Promise<string> {
  numVoters = Math.max(1, Math.min(numVoters, 10));
  k = Math.max(1, Math.min(k, 10));

  const totalStart = Date.now();
  const proposals: Array<{ voterId: number; proposal: string; state: VotingState }> = [];

  // Fase 1: Coletar propostas dos voters
  for (let i = 0; i < numVoters; i++) {
    const { winner, state } = await firstToAheadByKVoting(
      config,
      query,
      VOTER_SYSTEM_PROMPT,
      config.voterModel,
      k
    );
    proposals.push({ voterId: i + 1, proposal: winner, state });
  }

  const votingTime = (Date.now() - totalStart) / 1000;

  // Verificar se temos propostas válidas
  const validProposals = proposals.filter(p => p.proposal);
  if (validProposals.length === 0) {
    return "ERRO: Nenhum microagente conseguiu gerar uma proposta válida.";
  }

  // Fase 2: Julgamento
  const judgeStart = Date.now();
  const formattedProposals = validProposals
    .map(p => `=== PROPOSTA DO MICROAGENTE ${p.voterId} ===\n(Convergiu com ${p.state.validSamples} amostras válidas, ${p.state.redFlagged} descartadas)\n\n${p.proposal}`)
    .join("\n\n");

  const judgePrompt = `QUESTÃO ORIGINAL:
${query}

PROPOSTAS DOS MICROAGENTES:
${formattedProposals}

Analise as propostas e forneça sua decisão final seguindo o processo de julgamento.`;

  let judgeResponse: string;
  try {
    const { text } = await createMessage(
      config,
      config.judgeModel,
      JUDGE_SYSTEM_PROMPT,
      judgePrompt,
      0,
      4096
    );
    judgeResponse = text;
  } catch (error) {
    judgeResponse = `Erro no julgamento: ${error instanceof Error ? error.message : String(error)}`;
  }

  const judgeTime = (Date.now() - judgeStart) / 1000;
  const totalTime = (Date.now() - totalStart) / 1000;

  // Calcular métricas
  const totalSamples = proposals.reduce((sum, p) => sum + p.state.totalSamples, 0);
  const totalValid = proposals.reduce((sum, p) => sum + p.state.validSamples, 0);
  const totalFlagged = proposals.reduce((sum, p) => sum + p.state.redFlagged, 0);

  return `# MAKER-Council Report

## Configuração
- Voters: ${numVoters}
- Margem k (first-to-ahead-by-k): ${k}
- Modelo Voters: ${config.voterModel}
- Modelo Juiz: ${config.judgeModel}

## Métricas de Votação
- Total de amostras: ${totalSamples}
- Amostras válidas: ${totalValid}
- Red-flagged (descartadas): ${totalFlagged}
- Taxa de red-flag: ${totalSamples > 0 ? ((totalFlagged / totalSamples) * 100).toFixed(1) : 0}%

## Performance
- Tempo total: ${totalTime.toFixed(2)}s
- Tempo votação: ${votingTime.toFixed(2)}s
- Tempo julgamento: ${judgeTime.toFixed(2)}s

## Propostas Recebidas
${validProposals.map(p => `- Voter ${p.voterId}: ${p.proposal.length} chars, ${p.state.validSamples} votos, ${p.state.elapsedTime.toFixed(2)}s`).join("\n")}

## Decisão Final do Juiz

${judgeResponse}`;
}

async function handleSolveWithVoting(
  config: MakerConfig,
  query: string,
  k: number = 3
): Promise<string> {
  k = Math.max(1, Math.min(k, 10));

  const { winner, state } = await firstToAheadByKVoting(
    config,
    query,
    VOTER_SYSTEM_PROMPT,
    config.voterModel,
    k
  );

  if (!winner) {
    return "ERRO: Não foi possível convergir para uma resposta.";
  }

  const votesArray = Array.from(state.votes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return `# Resultado da Votação First-to-ahead-by-${k}

## Métricas
- Total de amostras: ${state.totalSamples}
- Amostras válidas: ${state.validSamples}
- Red-flagged: ${state.redFlagged}
- Candidatos únicos: ${state.votes.size}

## Performance
- Tempo total: ${state.elapsedTime.toFixed(2)}s

## Distribuição de Votos
${votesArray.map(([_, votes], i) => `- Candidato ${i + 1}: ${votes} votos`).join("\n")}

## Resposta Vencedora

${winner}`;
}

async function handleDecomposeTask(
  config: MakerConfig,
  task: string
): Promise<string> {
  const prompt = `Decomponha a seguinte tarefa em passos atômicos:\n\n${task}`;

  try {
    const { text } = await createMessage(
      config,
      config.judgeModel,
      DECOMPOSER_SYSTEM_PROMPT,
      prompt,
      0.3,
      2048
    );

    // Tentar extrair JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return text;
      }
    }
    return text;
  } catch (error) {
    return JSON.stringify({
      task,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2);
  }
}

// ============================================================================
// SERVIDOR MCP
// ============================================================================

async function main() {
  const config = getConfig();

  if (!config.apiKey) {
    console.error("Erro: MAKER_API_KEY não está definida.");
    console.error("Configure via variável de ambiente ou argumento --api-key=...");
    process.exit(1);
  }

  const server = new Server(
    {
      name: "maker-council",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handler para listar ferramentas
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Handler para executar ferramentas
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: string;

      switch (name) {
        case "consult_council":
          result = await handleConsultCouncil(
            config,
            args?.query as string,
            args?.num_voters as number | undefined,
            args?.k as number | undefined
          );
          break;

        case "solve_with_voting":
          result = await handleSolveWithVoting(
            config,
            args?.query as string,
            args?.k as number | undefined
          );
          break;

        case "decompose_task":
          result = await handleDecomposeTask(
            config,
            args?.task as string
          );
          break;

        default:
          throw new Error(`Ferramenta desconhecida: ${name}`);
      }

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Erro: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  // Iniciar servidor
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MAKER-Council MCP Server iniciado");
}

main().catch(console.error);