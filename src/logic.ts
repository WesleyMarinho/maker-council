/**
 * MAKER-Council processing logic
 * Extracts processing functions for reuse in the API server
 */

import OpenAI from "openai";
import { config } from "./config.js";
export type { Config as MakerConfig } from "./config.js";

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

// The MakerConfig interface is now imported and re-exported from config.ts

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
// LLM CLIENT (OpenAI-compatible)
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
    console.error(`[MAKER] Calling API: model=${model}, temp=${temperature}, maxTokens=${maxTokens}`);
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

    console.error(`[MAKER] Response received: choices=${response.choices?.length || 0}`);
    
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
    
    console.error(`[MAKER] Extracted text: ${text.substring(0, 100)}... (${tokens} tokens)`);
    console.error(`[MAKER] Has reasoning: ${!!reasoningText}, Has content: ${!!message?.content}`);
    
    return { text, tokens };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[MAKER] API error: ${errorMessage}`);
    if (error instanceof Error && 'response' in error) {
      console.error(`[MAKER] Response details:`, JSON.stringify((error as any).response?.data || {}));
    }
    throw new Error(`API error: ${errorMessage}`);
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
      reason: `Response too long (${numTokens} tokens > ${maxTokens})`,
      content: "",
    };
  }

  if (!response.trim()) {
    return {
      isValid: false,
      reason: "Empty response",
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

  const markers = ["Response:", "Solution:", "Answer:", "Result:"];
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

  // First deterministic sample (temperature=0)
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

  // Iterative voting
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

export const VOTER_SYSTEM_PROMPT = `You are a specialized microagent focused on technical precision.
Your task is to analyze the question and provide ONE clear and concise solution.

RULES:
1. Be direct and technical
2. Provide only the solution, without long explanations
3. If it's code, provide functional and complete code
4. Don't repeat the question or make preambles

Respond in a structured and objective manner.`;

export const JUDGE_SYSTEM_PROMPT = `You are the Senior Judge of the MAKER-Council.
Your role is to analyze multiple microagent proposals and synthesize the best solution.

JUDGMENT PROCESS:
1. CONSENSUS: If proposals agree, synthesize the best version combining strengths
2. MINOR DIVERGENCE: Choose the most robust approach and briefly justify
3. DANGEROUS DIVERGENCE: If proposals are contradictory in a way that may cause bugs or
   security issues, return exactly "RED FLAG:" followed by the conflict explanation

RESPONSE FORMAT:
- Start with "## Analysis" summarizing the proposals
- Then "## Decision" with the final solution
- If code, provide complete and functional code`;

export const DECOMPOSER_SYSTEM_PROMPT = `You are an expert in task decomposition following the MAKER methodology.
Your role is to break complex tasks into ATOMIC and ACTIONABLE steps.

MAKER DECOMPOSITION PRINCIPLES:
1. Each step must be a SINGLE verifiable action
2. Steps must be small enough for a microagent to execute without confusion
3. Dependencies between steps must be explicit
4. Avoid vague steps - be specific about WHAT to do

OUTPUT FORMAT (JSON):
{
    "task": "original description",
    "total_steps": number,
    "steps": [
        {
            "id": 1,
            "action": "specific action",
            "input": "what this step receives",
            "output": "what this step produces",
            "dependencies": []
        }
    ]
}`;

// ============================================================================
// SIMPLE PROMPT DETECTION (FAST MODE)
// ============================================================================

/**
 * List of greeting patterns and simple prompts that don't need voting
 */
const SIMPLE_PROMPT_PATTERNS = [
  // Greetings in Portuguese
  /^(oi|olá|ola|hey|eai|e aí|fala|salve|bom dia|boa tarde|boa noite|tudo bem|como vai|opa)[\s!?.]*$/i,
  // Greetings in English
  /^(hi|hello|hey|yo|sup|what's up|good morning|good afternoon|good evening|how are you)[\s!?.]*$/i,
  // Thanks
  /^(obrigado|obrigada|valeu|thanks|thank you|thx)[\s!?.]*$/i,
  // Farewells
  /^(tchau|adeus|bye|goodbye|até mais|ate mais|flw|falou)[\s!?.]*$/i,
  // Simple confirmations
  /^(ok|okay|sim|não|yes|no|certo|entendi|beleza)[\s!?.]*$/i,
];

/**
 * Removes XML tags and other wrappers from the prompt to get clean text.
 * This is necessary because some clients send prompts as <task>text</task>
 */
export function cleanPrompt(prompt: string): string {
  let cleaned = prompt.trim();
  
  // Remove the <environment_details>...</environment_details> block completely
  // Uses 's' flag (dotAll) so '.' also captures line breaks
  cleaned = cleaned.replace(/<environment_details>[\s\S]*?<\/environment_details>/gi, '');
  
  // Remove common XML tags
  cleaned = cleaned.replace(/<task>\s*/gi, '');
  cleaned = cleaned.replace(/\s*<\/task>/gi, '');
  cleaned = cleaned.replace(/<prompt>\s*/gi, '');
  cleaned = cleaned.replace(/\s*<\/prompt>/gi, '');
  cleaned = cleaned.replace(/<query>\s*/gi, '');
  cleaned = cleaned.replace(/\s*<\/query>/gi, '');
  cleaned = cleaned.replace(/<message>\s*/gi, '');
  cleaned = cleaned.replace(/\s*<\/message>/gi, '');
  
  // Remove any other generic XML tags (but preserve content)
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  
  return cleaned.trim();
}

/**
 * Checks if a prompt is "simple" (greeting, short question, etc.)
 * and can be answered directly without voting.
 */
export function isSimplePrompt(prompt: string): boolean {
  // First clean the prompt of XML tags
  const cleanedPrompt = cleanPrompt(prompt).toLowerCase();
  
  console.error(`[FAST MODE CHECK] Original prompt: "${prompt}"`);
  console.error(`[FAST MODE CHECK] Cleaned prompt: "${cleanedPrompt}"`);
  console.error(`[FAST MODE CHECK] Cleaned length: ${cleanedPrompt.length}`);
  console.error(`[FAST MODE CHECK] Max length config: ${config.simplePromptMaxLength}`);
  
  // Check if it's below the character limit
  if (cleanedPrompt.length > config.simplePromptMaxLength) {
    console.error(`[FAST MODE CHECK] Result: FALSE (too long)`);
    return false;
  }
  
  // Check if it matches any simple prompt pattern
  for (const pattern of SIMPLE_PROMPT_PATTERNS) {
    if (pattern.test(cleanedPrompt)) {
      console.error(`[FAST MODE CHECK] Result: TRUE (matched pattern: ${pattern})`);
      return true;
    }
  }
  
  // Very short prompts (less than 20 chars) without code are considered simple
  if (cleanedPrompt.length < 20 && !cleanedPrompt.includes('```') && !cleanedPrompt.includes('function')) {
    console.error(`[FAST MODE CHECK] Result: TRUE (short prompt < 20 chars)`);
    return true;
  }
  
  console.error(`[FAST MODE CHECK] Result: FALSE (no pattern matched)`);
  return false;
}

/**
 * Responds directly to simple prompts without using voting.
 * Makes just one call to the judge model.
 */
export async function handleFastMode(prompt: string): Promise<string> {
  const systemPrompt = `You are a friendly and concise assistant.
Respond naturally and directly, without excessive formatting.
For greetings, respond briefly and warmly.
For simple questions, give direct and objective answers.`;

  try {
    const { text } = await createMessage(
      config.judgeModel,
      systemPrompt,
      prompt,
      0.7,
      256  // Low tokens for quick responses
    );
    return text;
  } catch (error) {
    return `Hello! How can I help?`;
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
  if (!rawResult.includes('# MAKER-Council Report') && !rawResult.includes('# First-to-ahead-by-')) {
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
  
  // Try to extract "Winning Response" (for solve_with_voting)
  const winnerMatch = rawResult.match(/## Winning Response\s*\n\n([\s\S]*?)(?=\n## |$)/);
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
  console.error('\n[LOGIC DEBUG] ========== handleQuery STARTED ==========');
  console.error('[LOGIC DEBUG] Request received:', JSON.stringify(request, null, 2));
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
    console.error('[LOGIC DEBUG] FAST MODE ACTIVATED - simple prompt detected');
    
    const fastResponse = await handleFastMode(request.prompt);
    const totalTime = (Date.now() - startTime) / 1000;
    
    console.error('[LOGIC DEBUG] Fast response:', fastResponse.substring(0, 100));
    console.error('[LOGIC DEBUG] Total time (fast mode):', totalTime, 'seconds');
    console.error('[LOGIC DEBUG] ========== handleQuery COMPLETED (FAST) ==========\n');
    
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
  
  console.error('[LOGIC DEBUG] Inferred intent:', intent);
  console.error('[LOGIC DEBUG] Tool to be used:', toolUsed);
  
  const fullPrompt = buildFullPrompt(request.prompt, request.context);
  console.error('[LOGIC DEBUG] fullPrompt constructed:', fullPrompt.substring(0, 200) + '...');
  console.error('[LOGIC DEBUG] fullPrompt length:', fullPrompt.length);
  
  const numVoters = request.config?.num_voters;
  const k = request.config?.k;
  
  console.error('[LOGIC DEBUG] numVoters:', numVoters, 'k:', k);
  
  let rawOutput: string;
  let result: string | object;
  
  console.error('[LOGIC DEBUG] Executing tool:', toolUsed);
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
  
  console.error('[LOGIC DEBUG] rawOutput received:', rawOutput?.substring(0, 200) + '...');
  console.error('[LOGIC DEBUG] rawOutput length:', rawOutput?.length || 0);
  
  const totalTime = (Date.now() - startTime) / 1000;
  console.error('[LOGIC DEBUG] Total time:', totalTime, 'seconds');
  console.error('[LOGIC DEBUG] ========== handleQuery COMPLETED ==========\n');
  
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
    judgeResponse = `Judgment error: ${error instanceof Error ? error.message : String(error)}`;
  }

  const judgeTime = (Date.now() - judgeStart) / 1000;
  const totalTime = (Date.now() - totalStart) / 1000;

  const totalSamples = proposals.reduce((sum, p) => sum + p.state.totalSamples, 0);
  const totalValid = proposals.reduce((sum, p) => sum + p.state.validSamples, 0);
  const totalFlagged = proposals.reduce((sum, p) => sum + p.state.redFlagged, 0);

  return `# MAKER-Council Report\n\n## Configuration\n- Voters: ${numVoters}\n- Margin k (first-to-ahead-by-k): ${k}\n- Voters Model: ${config.voterModel}\n- Judge Model: ${config.judgeModel}\n\n## Voting Metrics\n- Total samples: ${totalSamples}\n- Valid samples: ${totalValid}\n- Red-flagged (discarded): ${totalFlagged}\n- Red-flag rate: ${totalSamples > 0 ? ((totalFlagged / totalSamples) * 100).toFixed(1) : 0}%\n\n## Performance\n- Total time: ${totalTime.toFixed(2)}s\n- Voting time: ${votingTime.toFixed(2)}s\n- Judgment time: ${judgeTime.toFixed(2)}s\n\n## Received Proposals\n${validProposals.map(p => `- Voter ${p.voterId}: ${p.proposal.length} chars, ${p.state.validSamples} votes, ${p.state.elapsedTime.toFixed(2)}s`).join("\n")}\n\n## Judge's Final Decision\n\n${judgeResponse}`;
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

  return `# First-to-ahead-by-${k} Voting Result\n\n## Metrics\n- Total samples: ${state.totalSamples}\n- Valid samples: ${state.validSamples}\n- Red-flagged: ${state.redFlagged}\n- Unique candidates: ${state.votes.size}\n\n## Performance\n- Total time: ${state.elapsedTime.toFixed(2)}s\n\n## Vote Distribution\n${votesArray.map(([_, votes], i) => `- Candidate ${i + 1}: ${votes} votes`).join("\n")}\n\n## Winning Response\n\n${winner}`;
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