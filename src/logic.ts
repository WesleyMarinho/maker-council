/**
 * Lógica de processamento do MAKER-Council
 * Extrai as funções de processamento para reutilização no servidor API
 */

import OpenAI from "openai";
import { config } from "./config.js";
export type { Config as MakerConfig } from "./config.js";

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

// A interface MakerConfig agora é importada e re-exportada de config.ts

export interface VotingState {
  votes: Map<string, number>;
  totalSamples: number;
  validSamples: number;
  redFlagged: number;
  elapsedTime: number;
}

export interface RedFlagResult {
  isValid: boolean;
  reason?: string;
  content: string;
}

export type Intent = 'decision' | 'code_review' | 'decomposition' | 'validation';
export type ToolUsed = 'consult_council' | 'decompose_task' | 'solve_with_voting';

export interface QueryContext {
  code?: string;
  history?: Array<{ role: string; content: string }>;
  filePath?: string;
  [key: string]: unknown;
}

export interface QueryConfig {
  num_voters?: number;
  k?: number;
  model?: string;
}

export interface QueryRequest {
  prompt: string;
  context?: QueryContext;
  intent?: Intent;
  config?: QueryConfig;
}

export interface QueryResponseMetadata {
  tool_used: ToolUsed;
  request_id: string;
  timestamp: string;
  performance: {
    total_time_seconds: number;
  };
  raw_output: string;
}

export interface QueryResponse {
  result: string | object;
  metadata: QueryResponseMetadata;
}

// ============================================================================
// CLIENTE LLM (OpenAI-compatible)
// ============================================================================

let openaiClient: OpenAI | null = null;

export function getClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.apiUrl,
    });
  }
  return openaiClient;
}

export async function createMessage(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
  maxTokens: number = 1024
): Promise<{ text: string; tokens: number }> {
  const client = getClient();
  
  try {
    console.error(`[MAKER] Chamando API: model=${model}, temp=${temperature}, maxTokens=${maxTokens}`);
    console.error(`[MAKER] Base URL: ${config.apiUrl}`);
    
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
    
    const message = response.choices?.[0]?.message as any;
    let text = message?.content || "";
    const reasoningText = message?.reasoning_content || "";
    
    if (reasoningText && text) {
      text = text;
    } else if (reasoningText && !text) {
      text = reasoningText;
    } else if (!reasoningText && !text) {
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

export function checkRedFlags(
  response: string,
  numTokens: number,
  maxTokens: number
): RedFlagResult {
  if (numTokens > maxTokens) {
    return {
      isValid: false,
      reason: `Resposta muito longa (${numTokens} tokens > ${maxTokens})`,
      content: "",
    };
  }

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

export function extractAnswer(response: string): string {
  const codeMatch = response.match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (codeMatch) {
    return codeMatch[1].trim();
  }

  const markers = ["Resposta:", "Solução:", "Answer:", "Solution:", "Result:"];
  for (const marker of markers) {
    if (response.includes(marker)) {
      return response.split(marker)[1].trim();
    }
  }

  return response.trim();
}

export async function firstToAheadByKVoting(
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

export function checkWinner(votes: Map<string, number>, candidate: string, k: number): boolean {
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

export const VOTER_SYSTEM_PROMPT = `Você é um microagente especializado focado em precisão técnica.
Sua tarefa é analisar a questão e fornecer UMA solução clara e concisa.

REGRAS:
1. Seja direto e técnico
2. Forneça apenas a solução, sem explicações longas
3. Se for código, forneça código funcional e completo
4. Não repita a pergunta nem faça preâmbulos

Responda de forma estruturada e objetiva.`;

export const JUDGE_SYSTEM_PROMPT = `Você é o Juiz Sênior do MAKER-Council.
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

export const DECOMPOSER_SYSTEM_PROMPT = `Você é um especialista em decomposição de tarefas seguindo a metodologia MAKER.
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
// DETECÇÃO DE PROMPTS SIMPLES (MODO RÁPIDO)
// ============================================================================

/**
 * Lista de padrões de saudações e prompts simples que não precisam de votação
 */
const SIMPLE_PROMPT_PATTERNS = [
  // Saudações em português
  /^(oi|olá|ola|hey|eai|e aí|fala|salve|bom dia|boa tarde|boa noite|tudo bem|como vai|opa)[\s!?.]*$/i,
  // Saudações em inglês
  /^(hi|hello|hey|yo|sup|what's up|good morning|good afternoon|good evening|how are you)[\s!?.]*$/i,
  // Agradecimentos
  /^(obrigado|obrigada|valeu|thanks|thank you|thx)[\s!?.]*$/i,
  // Despedidas
  /^(tchau|adeus|bye|goodbye|até mais|ate mais|flw|falou)[\s!?.]*$/i,
  // Confirmações simples
  /^(ok|okay|sim|não|yes|no|certo|entendi|beleza)[\s!?.]*$/i,
];

/**
 * Remove tags XML e outros wrappers do prompt para obter o texto limpo.
 * Isso é necessário porque alguns clientes enviam prompts como <task>texto</task>
 */
export function cleanPrompt(prompt: string): string {
  let cleaned = prompt.trim();
  
  // Remove tags XML comuns
  cleaned = cleaned.replace(/<task>\s*/gi, '');
  cleaned = cleaned.replace(/\s*<\/task>/gi, '');
  cleaned = cleaned.replace(/<prompt>\s*/gi, '');
  cleaned = cleaned.replace(/\s*<\/prompt>/gi, '');
  cleaned = cleaned.replace(/<query>\s*/gi, '');
  cleaned = cleaned.replace(/\s*<\/query>/gi, '');
  cleaned = cleaned.replace(/<message>\s*/gi, '');
  cleaned = cleaned.replace(/\s*<\/message>/gi, '');
  
  // Remove quaisquer outras tags XML genéricas (mas preserva conteúdo)
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  
  return cleaned.trim();
}

/**
 * Verifica se um prompt é "simples" (saudação, pergunta curta, etc.)
 * e pode ser respondido diretamente sem votação.
 */
export function isSimplePrompt(prompt: string): boolean {
  // Primeiro limpa o prompt de tags XML
  const cleanedPrompt = cleanPrompt(prompt).toLowerCase();
  
  console.error(`[FAST MODE CHECK] Original prompt: "${prompt}"`);
  console.error(`[FAST MODE CHECK] Cleaned prompt: "${cleanedPrompt}"`);
  console.error(`[FAST MODE CHECK] Cleaned length: ${cleanedPrompt.length}`);
  console.error(`[FAST MODE CHECK] Max length config: ${config.simplePromptMaxLength}`);
  
  // Verifica se está abaixo do limite de caracteres
  if (cleanedPrompt.length > config.simplePromptMaxLength) {
    console.error(`[FAST MODE CHECK] Result: FALSE (too long)`);
    return false;
  }
  
  // Verifica se corresponde a algum padrão de prompt simples
  for (const pattern of SIMPLE_PROMPT_PATTERNS) {
    if (pattern.test(cleanedPrompt)) {
      console.error(`[FAST MODE CHECK] Result: TRUE (matched pattern: ${pattern})`);
      return true;
    }
  }
  
  // Prompts muito curtos (menos de 20 chars) sem código são considerados simples
  if (cleanedPrompt.length < 20 && !cleanedPrompt.includes('```') && !cleanedPrompt.includes('function')) {
    console.error(`[FAST MODE CHECK] Result: TRUE (short prompt < 20 chars)`);
    return true;
  }
  
  console.error(`[FAST MODE CHECK] Result: FALSE (no pattern matched)`);
  return false;
}

/**
 * Responde diretamente a prompts simples sem usar votação.
 * Faz apenas uma chamada ao modelo judge.
 */
export async function handleFastMode(prompt: string): Promise<string> {
  const systemPrompt = `Você é um assistente amigável e conciso.
Responda de forma natural e direta, sem formatação excessiva.
Para saudações, responda de forma breve e acolhedora.
Para perguntas simples, dê respostas diretas e objetivas.`;

  try {
    const { text } = await createMessage(
      config.judgeModel,
      systemPrompt,
      prompt,
      0.7,
      256  // Tokens baixos para respostas rápidas
    );
    return text;
  } catch (error) {
    return `Olá! Como posso ajudar?`;
  }
}

// ============================================================================
// EXTRAÇÃO DE RESPOSTA LIMPA
// ============================================================================

/**
 * Extrai apenas a resposta útil do resultado, removendo metadados e relatórios técnicos.
 */
export function extractCleanResponse(rawResult: string): string {
  // Se não é um relatório MAKER, retorna como está
  if (!rawResult.includes('# MAKER-Council Report') && !rawResult.includes('# Resultado da Votação')) {
    return rawResult;
  }
  
  // Tenta extrair a "Decisão Final do Juiz"
  const judgeDecisionMatch = rawResult.match(/## Decisão Final do Juiz\s*\n\n([\s\S]*?)(?=\n## |$)/);
  if (judgeDecisionMatch) {
    return judgeDecisionMatch[1].trim();
  }
  
  // Tenta extrair a seção "## Decisão"
  const decisionMatch = rawResult.match(/## Decisão\s*\n\n?([\s\S]*?)(?=\n## |$)/);
  if (decisionMatch) {
    return decisionMatch[1].trim();
  }
  
  // Tenta extrair "Resposta Vencedora" (para solve_with_voting)
  const winnerMatch = rawResult.match(/## Resposta Vencedora\s*\n\n([\s\S]*?)(?=\n## |$)/);
  if (winnerMatch) {
    return winnerMatch[1].trim();
  }
  
  // Se tem seção de Análise seguida de Decisão, pega a Decisão
  const analysisDecisionMatch = rawResult.match(/## Análise[\s\S]*?## Decisão\s*\n\n?([\s\S]*?)(?=\n## |$)/);
  if (analysisDecisionMatch) {
    return analysisDecisionMatch[1].trim();
  }
  
  // Fallback: remove o cabeçalho do relatório e retorna o resto
  const withoutHeader = rawResult.replace(/# MAKER-Council Report[\s\S]*?## Decisão Final do Juiz\s*\n\n/, '');
  if (withoutHeader !== rawResult) {
    return withoutHeader.trim();
  }
  
  // Último fallback: retorna o texto original
  return rawResult;
}

// ============================================================================
// INFERÊNCIA DE INTENT
// ============================================================================

export function generateRequestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function inferIntent(prompt: string): Intent {
  const lowerPrompt = prompt.toLowerCase();
  
  const decompositionKeywords = [
    'decomponha', 'decompose', 'divida em passos', 'divide into steps',
    'crie um plano', 'create a plan', 'quebre em tarefas', 'break down',
    'liste os passos', 'list the steps', 'passo a passo', 'step by step',
    'planeje', 'plan out', 'etapas para', 'steps to'
  ];
  
  for (const keyword of decompositionKeywords) {
    if (lowerPrompt.includes(keyword)) {
      return 'decomposition';
    }
  }
  
  const validationPatterns = [
    /\b(melhor|better|best)\b.*\b(ou|or)\b/,
    /\busar\s+\w+\s+ou\s+\w+/,
    /\buse\s+\w+\s+or\s+\w+/,
    /\bqual\s+(é\s+)?(a\s+)?(melhor|correta)/,
    /\bwhich\s+(is\s+)?(the\s+)?(best|correct)/,
    /\bdevo\s+usar\b/,
    /\bshould\s+i\s+use\b/,
    /\bé\s+(melhor|correto|recomendado)\b/,
    /\bis\s+(it\s+)?(better|correct|recommended)\b/
  ];
  
  for (const pattern of validationPatterns) {
    if (pattern.test(lowerPrompt)) {
      return 'validation';
    }
  }
  
  return 'decision';
}

export function intentToTool(intent: Intent): ToolUsed {
  switch (intent) {
    case 'decision':
    case 'code_review':
      return 'consult_council';
    case 'decomposition':
      return 'decompose_task';
    case 'validation':
      return 'solve_with_voting';
  }
}

export function buildFullPrompt(prompt: string, context?: QueryContext): string {
  if (!context) {
    return prompt;
  }
  
  const parts: string[] = [];
  
  if (context.filePath) {
    parts.push(`Arquivo: ${context.filePath}`);
  }
  
  if (context.code) {
    parts.push(`Código:\n\`\`\`\n${context.code}\n\`\`\``);
  }
  
  if (context.history && context.history.length > 0) {
    const historyText = context.history
      .map(h => `${h.role}: ${h.content}`)
      .join('\n');
    parts.push(`Histórico:\n${historyText}`);
  }
  
  parts.push(`Consulta: ${prompt}`);
  
  return parts.join('\n\n');
}

// ============================================================================
// HANDLERS DAS FERRAMENTAS
// ============================================================================

export async function handleQuery(
  request: QueryRequest
): Promise<QueryResponse> {
  console.error('\n[LOGIC DEBUG] ========== handleQuery INICIADO ==========');
  console.error('[LOGIC DEBUG] Request recebido:', JSON.stringify(request, null, 2));
  console.error('[LOGIC DEBUG] request.prompt:', request.prompt);
  console.error('[LOGIC DEBUG] request.prompt length:', request.prompt?.length || 0);
  
  const startTime = Date.now();
  const requestId = generateRequestId();
  
  // ========== MODO RÁPIDO ==========
  // Log de verificação do modo rápido
  console.error('[HANDLE QUERY] config.fastMode:', config.fastMode);
  const simpleCheck = isSimplePrompt(request.prompt);
  console.error('[HANDLE QUERY] isSimplePrompt result:', simpleCheck);
  
  // Se fastMode está habilitado e o prompt é simples, responde diretamente
  if (config.fastMode && simpleCheck) {
    console.error('[LOGIC DEBUG] MODO RÁPIDO ATIVADO - prompt simples detectado');
    
    const fastResponse = await handleFastMode(request.prompt);
    const totalTime = (Date.now() - startTime) / 1000;
    
    console.error('[LOGIC DEBUG] Resposta rápida:', fastResponse.substring(0, 100));
    console.error('[LOGIC DEBUG] Tempo total (modo rápido):', totalTime, 'segundos');
    console.error('[LOGIC DEBUG] ========== handleQuery FINALIZADO (FAST) ==========\n');
    
    return {
      result: fastResponse,
      metadata: {
        tool_used: 'consult_council' as ToolUsed,
        request_id: requestId,
        timestamp: new Date().toISOString(),
        performance: {
          total_time_seconds: totalTime
        },
        raw_output: fastResponse
      }
    };
  }
  // ========== FIM MODO RÁPIDO ==========
  
  const intent: Intent = request.intent || inferIntent(request.prompt);
  const toolUsed: ToolUsed = intentToTool(intent);
  
  console.error('[LOGIC DEBUG] Intent inferido:', intent);
  console.error('[LOGIC DEBUG] Tool a ser usada:', toolUsed);
  
  const fullPrompt = buildFullPrompt(request.prompt, request.context);
  console.error('[LOGIC DEBUG] fullPrompt construído:', fullPrompt.substring(0, 200) + '...');
  console.error('[LOGIC DEBUG] fullPrompt length:', fullPrompt.length);
  
  const numVoters = request.config?.num_voters;
  const k = request.config?.k;
  
  console.error('[LOGIC DEBUG] numVoters:', numVoters, 'k:', k);
  
  let rawOutput: string;
  let result: string | object;
  
  console.error('[LOGIC DEBUG] Executando tool:', toolUsed);
  switch (toolUsed) {
    case 'consult_council':
      rawOutput = await handleConsultCouncil(fullPrompt, numVoters, k);
      result = config.includeReport ? rawOutput : extractCleanResponse(rawOutput);
      break;
      
    case 'decompose_task':
      rawOutput = await handleDecomposeTask(fullPrompt);
      try {
        result = JSON.parse(rawOutput);
      } catch {
        result = rawOutput;
      }
      break;
      
    case 'solve_with_voting':
      rawOutput = await handleSolveWithVoting(fullPrompt, k);
      result = config.includeReport ? rawOutput : extractCleanResponse(rawOutput);
      break;
  }
  
  console.error('[LOGIC DEBUG] rawOutput recebido:', rawOutput?.substring(0, 200) + '...');
  console.error('[LOGIC DEBUG] rawOutput length:', rawOutput?.length || 0);
  
  const totalTime = (Date.now() - startTime) / 1000;
  console.error('[LOGIC DEBUG] Tempo total:', totalTime, 'segundos');
  console.error('[LOGIC DEBUG] ========== handleQuery FINALIZADO ==========\n');
  
  return {
    result,
    metadata: {
      tool_used: toolUsed,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      performance: {
        total_time_seconds: totalTime
      },
      raw_output: rawOutput
    }
  };
}

export async function handleConsultCouncil(
  query: string,
  numVoters: number = 3,
  k: number = 3
): Promise<string> {
  numVoters = Math.max(1, Math.min(numVoters, 10));
  k = Math.max(1, Math.min(k, 10));

  const totalStart = Date.now();
  const proposals: Array<{ voterId: number; proposal: string; state: VotingState }> = [];

  for (let i = 0; i < numVoters; i++) {
    const { winner, state } = await firstToAheadByKVoting(
      query,
      VOTER_SYSTEM_PROMPT,
      config.voterModel,
      k
    );
    proposals.push({ voterId: i + 1, proposal: winner, state });
  }

  const votingTime = (Date.now() - totalStart) / 1000;

  const validProposals = proposals.filter(p => p.proposal);
  if (validProposals.length === 0) {
    return "ERRO: Nenhum microagente conseguiu gerar uma proposta válida.";
  }

  const judgeStart = Date.now();
  const formattedProposals = validProposals
    .map(p => `=== PROPOSTA DO MICROAGENTE ${p.voterId} ===\n(Convergiu com ${p.state.validSamples} amostras válidas, ${p.state.redFlagged} descartadas)\n\n${p.proposal}`)
    .join("\n\n");

  const judgePrompt = `QUESTÃO ORIGINAL:\n${query}\n\nPROPOSTAS DOS MICROAGENTES:\n${formattedProposals}\n\nAnalise as propostas e forneça sua decisão final seguindo o processo de julgamento.`;

  let judgeResponse: string;
  try {
    const { text } = await createMessage(
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

  const totalSamples = proposals.reduce((sum, p) => sum + p.state.totalSamples, 0);
  const totalValid = proposals.reduce((sum, p) => sum + p.state.validSamples, 0);
  const totalFlagged = proposals.reduce((sum, p) => sum + p.state.redFlagged, 0);

  return `# MAKER-Council Report\n\n## Configuração\n- Voters: ${numVoters}\n- Margem k (first-to-ahead-by-k): ${k}\n- Modelo Voters: ${config.voterModel}\n- Modelo Juiz: ${config.judgeModel}\n\n## Métricas de Votação\n- Total de amostras: ${totalSamples}\n- Amostras válidas: ${totalValid}\n- Red-flagged (descartadas): ${totalFlagged}\n- Taxa de red-flag: ${totalSamples > 0 ? ((totalFlagged / totalSamples) * 100).toFixed(1) : 0}%\n\n## Performance\n- Tempo total: ${totalTime.toFixed(2)}s\n- Tempo votação: ${votingTime.toFixed(2)}s\n- Tempo julgamento: ${judgeTime.toFixed(2)}s\n\n## Propostas Recebidas\n${validProposals.map(p => `- Voter ${p.voterId}: ${p.proposal.length} chars, ${p.state.validSamples} votos, ${p.state.elapsedTime.toFixed(2)}s`).join("\n")}\n\n## Decisão Final do Juiz\n\n${judgeResponse}`;
}

export async function handleSolveWithVoting(
  query: string,
  k: number = 3
): Promise<string> {
  k = Math.max(1, Math.min(k, 10));

  const { winner, state } = await firstToAheadByKVoting(
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

  return `# Resultado da Votação First-to-ahead-by-${k}\n\n## Métricas\n- Total de amostras: ${state.totalSamples}\n- Amostras válidas: ${state.validSamples}\n- Red-flagged: ${state.redFlagged}\n- Candidatos únicos: ${state.votes.size}\n\n## Performance\n- Tempo total: ${state.elapsedTime.toFixed(2)}s\n\n## Distribuição de Votos\n${votesArray.map(([_, votes], i) => `- Candidato ${i + 1}: ${votes} votos`).join("\n")}\n\n## Resposta Vencedora\n\n${winner}`;
}

export async function handleDecomposeTask(task: string): Promise<string> {
  const prompt = `Decomponha a seguinte tarefa em passos atômicos:\n\n${task}`;

  try {
    const { text } = await createMessage(
      config.judgeModel,
      DECOMPOSER_SYSTEM_PROMPT,
      prompt,
      0.3,
      2048
    );

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
// FUNÇÃO DE CONFIGURAÇÃO (REMOVIDA)
// ============================================================================
// A função getConfig() foi removida. A configuração agora é importada
// diretamente do módulo 'config.ts' como um objeto único e imutável.