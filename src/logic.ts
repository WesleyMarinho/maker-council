/**
 * MAKER-Council processing logic
 * Extracts processing functions for reuse in the API server
 */

import OpenAI from "openai";
import { ChatCompletionMessageParam } from 'openai/resources/index.mjs'; // Add this import
import { config } from "./config.js";
import {
  McpToolManager,
  ToolSchemaTranslator,
  type McpServerConfig,
  type OpenAIToolCall,
  type ToolExecutionResult,
  type AgentLoopConfig,
  type AgentLoopResult,
} from "./mcp-client/index.js";
export type { Config as MakerConfig } from "./config.js";
import { internalTools } from './internal-tools.js';
import { OpenAITool } from './mcp-client/types.js';

let availableTools: OpenAITool[] = [];

export async function initializeLogic() {
  console.error('[LOGIC] Initializing logic and loading tools...');
  const manager = await initializeMcpClient();
  const externalTools = manager ? manager.getToolsAsOpenAI() : [];
  availableTools = [...internalTools, ...externalTools];
  console.error(`[LOGIC] Initialization complete. ${availableTools.length} tools available.`);
  availableTools.forEach(tool => console.error(`       - ${tool.function.name}`));
}

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
  recursionDepth?: number;
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
  tool_used: string;
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
  temperature: number = 0.1,
  maxTokens: number = 1024
): Promise<{ text: string; tokens: number }> {
  const url = `${config.apiUrl}chat/completions`;

  try {
    console.error(`[MAKER] Calling API: model=${model}, temp=${temperature}, maxTokens=${maxTokens}`);
    console.error(`[MAKER] Full URL: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${response.status} ${errorText}`);
    }

    const data = await response.json() as any;

    console.error(`[MAKER] Response received: choices=${data.choices?.length || 0}`);

    const message = data.choices?.[0]?.message as any;
    let text = message?.content || "";
    const reasoningText = message?.reasoning_content || "";

    if (reasoningText && text) {
      text = text;
    } else if (reasoningText && !text) {
      text = reasoningText;
    } else if (!reasoningText && !text) {
      text = JSON.stringify(message);
    }

    const tokens = data.usage?.completion_tokens || Math.ceil(text.length / 4);

    console.error(`[MAKER] Extracted text: ${text.substring(0, 100)}... (${tokens} tokens)`);
    console.error(`[MAKER] Has reasoning: ${!!reasoningText}, Has content: ${!!message?.content}`);

    return { text, tokens };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[MAKER] API error: ${errorMessage}`);
    throw new Error(`API error: ${errorMessage}`);
  }
}

// ============================================================================
// RED-FLAGGING (Section 3.3 of the paper)
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
// FIRST-TO-AHEAD-BY-K VOTING (Section 3.2 of the paper)
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
  temperature: number = 0.1
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

  // Parallel Samples (batch execution)
  const pendingSamples = config.maxRounds - state.totalSamples;
  const BATCH_SIZE = 5; // Adjust as needed for rate limits

  for (let i = 0; i < pendingSamples; i += BATCH_SIZE) {
    const currentBatchSize = Math.min(BATCH_SIZE, pendingSamples - i);
    const promises = Array.from({ length: currentBatchSize }, () =>
      createMessage(
        model,
        systemPrompt,
        prompt,
        temperature,
        config.maxTokens + 100
      ).catch(() => null) // Suppress errors in Promise.all to handle them individually
    );

    const batchResults = await Promise.all(promises);

    for (const result of batchResults) {
      if (!result) {
        state.redFlagged++;
        continue;
      }

      state.totalSamples++;
      const flagResult = checkRedFlags(result.text, result.tokens, config.maxTokens);

      if (flagResult.isValid) {
        const canonical = extractAnswer(result.text);
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
// SYSTEM PROMPTS
// ============================================================================

export const VOTER_SYSTEM_PROMPT = `You are a specialized microagent focused on technical precision.
Your task is to analyze the question and provide ONE clear and concise solution.

RULES:
1. Be direct and technical.
2. Provide only the solution, without long explanations.
3. If it's code, provide functional and complete code.
4. Do not repeat the question or make preambles.

Respond in a structured and objective manner.`;

export const JUDGE_SYSTEM_PROMPT = `You are the Senior Judge of the MAKER-Council.
Your role is to analyze multiple microagent proposals and synthesize the best solution.

JUDGMENT PROCESS:
1. CONSENSUS: If proposals agree, synthesize the best version by combining their strengths.
2. MINOR DIVERGENCE: Choose the most robust approach and briefly justify your choice.
3. DANGEROUS DIVERGENCE: If proposals are contradictory in a way that may cause bugs or security issues, return exactly "RED FLAG:" followed by an explanation of the conflict.

RESPONSE FORMAT:
- Start with "## Analysis" summarizing the proposals.
- Follow with "## Decision" presenting the final solution.
- If the solution involves code, provide the complete and functional code.`;

export const DECOMPOSER_SYSTEM_PROMPT = `You are an expert in task decomposition following the MAKER methodology.
Your role is to break down complex tasks into ATOMIC and ACTIONABLE steps.

MAKER DECOMPOSITION PRINCIPLES:
1. Each step must be a SINGLE verifiable action.
2. Steps must be small enough for a microagent to execute without confusion.
3. Dependencies between steps must be explicit.
4. Avoid vague steps—be specific about WHAT to do.

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
// CLEAN RESPONSE EXTRACTION
// ============================================================================

/**
 * Extracts only the useful response from the result, removing metadata and technical reports.
 */
export function extractCleanResponse(rawResult: string): string {
  // If it's not a MAKER report, return as is
  if (!rawResult.includes('# MAKER-Council Report') && !rawResult.includes('# First-to-ahead-by-')) {
    return rawResult;
  }

  // Try to extract the final judge's decision
  const judgeDecisionMatch = rawResult.match(/## Decisão Final do Juiz\s*\n\n([\s\S]*?)(?=\n## |$)/);
  if (judgeDecisionMatch) {
    return judgeDecisionMatch[1].trim();
  }

  // Try to extract the "## Decisão" section
  const decisionMatch = rawResult.match(/## Decisão\s*\n\n?([\s\S]*?)(?=\n## |$)/);
  if (decisionMatch) {
    return decisionMatch[1].trim();
  }

  // Try to extract "Winning Response" (for solve_with_voting)
  const winnerMatch = rawResult.match(/## Winning Response\s*\n\n([\s\S]*?)(?=\n## |$)/);
  if (winnerMatch) {
    return winnerMatch[1].trim();
  }

  // If there's an Analysis section followed by a Decision, get the Decision
  const analysisDecisionMatch = rawResult.match(/## Análise[\s\S]*?## Decisão\s*\n\n?([\s\S]*?)(?=\n## |$)/);
  if (analysisDecisionMatch) {
    return analysisDecisionMatch[1].trim();
  }

  // Fallback: remove the report header and return the rest
  const withoutHeader = rawResult.replace(/# MAKER-Council Report[\s\S]*?## Decisão Final do Juiz\s*\n\n/, '');
  if (withoutHeader !== rawResult) {
    return withoutHeader.trim();
  }

  // Last fallback: return the original text
  return rawResult;
}

export function generateRequestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function isSimpleGreeting(prompt: string): boolean {
  const normalizedPrompt = prompt.trim().toLowerCase();
  const greetings = ['hello', 'hi', 'hey', 'oi', 'olá', 'hello!', 'hi!'];
  return greetings.includes(normalizedPrompt);
}

function isMcpMetaQuestion(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const mcpKeywords = ['mcp', 'integra', 'ferramenta', 'tool', 'servidor', 'server'];
  const metaKeywords = ['como funciona', 'how does', 'de onde', 'where', 'what is', 'como', 'funciona', 'obtemos', 'disponiveis'];

  const hasMcpKeyword = mcpKeywords.some(keyword => normalized.includes(keyword));
  const hasMetaKeyword = metaKeywords.some(keyword => normalized.includes(keyword));

  const result = hasMcpKeyword && hasMetaKeyword;
  console.error(`[LOGIC] isMcpMetaQuestion: mcp=${hasMcpKeyword}, meta=${hasMetaKeyword}, result=${result}`);

  return result;
}

export function buildFullPrompt(prompt: string, context?: QueryContext): string {
  if (!context) {
    return prompt;
  }

  const parts: string[] = [];

  if (context.filePath) {
    parts.push(`File: ${context.filePath}`);
  }

  if (context.code) {
    parts.push(`Code:\n\`\`\`\n${context.code}\n\`\`\``);
  }

  if (context.history && context.history.length > 0) {
    const historyText = context.history
      .map(h => `${h.role}: ${h.content}`)
      .join('\n');
    parts.push(`History:\n${historyText}`);
  }

  parts.push(`Query: ${prompt}`);

  return parts.join('\n\n');
}

export async function handleQuery(request: QueryRequest): Promise<QueryResponse> {
  const startTime = Date.now();
  const requestId = generateRequestId();

  // Recursion Guard (Loop Prevention)
  const currentDepth = request.context?.recursionDepth || 0;
  if (currentDepth > config.maxRecursionDepth) {
    console.error(`[LOGIC] Max recursion depth reached (${currentDepth}). Aborting.`);
    return {
      result: `Error: Maximum recursion depth reached. The agent loop was terminated to prevent infinite loops.`,
      metadata: {
        tool_used: 'system_error',
        request_id: requestId,
        timestamp: new Date().toISOString(),
        performance: {
          total_time_seconds: 0,
        },
        raw_output: "Max recursion depth reached."
      }
    };
  }

  // Fast path for simple greetings - bypass tool dispatcher
  if (isSimpleGreeting(request.prompt)) {
    console.error('[LOGIC] Simple greeting detected. Bypassing tool dispatcher.');
    const totalTime = (Date.now() - startTime) / 1000;
    return {
      result: "Hello! How can I help you today?",
      metadata: {
        tool_used: 'none',
        request_id: requestId,
        timestamp: new Date().toISOString(),
        performance: {
          total_time_seconds: totalTime,
        },
        raw_output: "Simple greeting response.",
      }
    };
  }

  // Fast path for MCP meta questions
  if (isMcpMetaQuestion(request.prompt)) {
    console.error('[LOGIC] MCP meta question detected. Providing direct answer.');
    const totalTime = (Date.now() - startTime) / 1000;
    const mcpAnswer = `A integração MCP (Model Context Protocol) do MAKER-Council funciona da seguinte forma:

**Fonte dos Servidores MCP:**
- Os servidores MCP são configurados no arquivo \`maker-mcps/mcp.json\`
- Este arquivo contém uma lista de servidores, cada um com comando, argumentos e configurações

**Como Funciona:**
1. No startup, o sistema lê o arquivo \`mcp.json\`
2. Para cada servidor habilitado, inicia um processo child com o comando especificado
3. Conecta via stdio (stdin/stdout) usando o protocolo MCP
4. Descobre as ferramentas disponíveis em cada servidor
5. Integra essas ferramentas com as ferramentas internas (consult_council, solve_with_voting, decompose_task)

**Servidores Configurados Atualmente:**
- **serena**: Ferramentas de busca e análise de código (requer Git)
- **filesystem-access**: Ferramentas de leitura/escrita de arquivos (${availableTools.filter(t => t.function.name.includes('filesystem')).length} ferramentas)

**Total de Ferramentas Disponíveis:** ${availableTools.length}

Para adicionar mais servidores MCP, edite o arquivo \`maker-mcps/mcp.json\`.`;

    return {
      result: mcpAnswer,
      metadata: {
        tool_used: 'direct_answer',
        request_id: requestId,
        timestamp: new Date().toISOString(),
        performance: {
          total_time_seconds: totalTime,
        },
        raw_output: "MCP meta question answered directly.",
      }
    };
  }

  console.error('[LOGIC] New handleQuery received request:', request.prompt);
  console.error(`[LOGIC] ${availableTools.length} tools are available for routing.`);

  // --- RE-ACT AGENT LOOP ---
  // Determine if we have external MCP tools available
  const hasExternalTools = availableTools.some(t => !internalTools.some(it => it.function.name === t.function.name));
  const toolsDescription = hasExternalTools
    ? 'Internal MAKER-Council tools AND external MCP tools are available.'
    : 'ONLY internal MAKER-Council tools are available. No external MCP servers are connected.';

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are a high-level orchestration agent (MAKER-Council).
      
      GOAL: Resolve the user's request efficiently using available tools.

      TOOL AVAILABILITY: ${toolsDescription}

      TOOLS AVAILABLE (use ONLY these):
      ${availableTools.map(t => `- ${t.function.name}: ${(t.function.description || '').split('\n')[0]}`).join('\n')}
      
      IMPORTANT - When to Answer Directly:
      1. **Meta Questions**: If the user asks about how THIS system works (MCP integration, configuration, architecture), answer directly based on what you know. DO NOT call external tools.
      2. **General Knowledge**: For factual questions you can answer, respond directly.
      3. **After Tool Execution**: Once you have the information from a tool, formulate the final answer yourself.
      4. **No Suitable Tool**: If none of the available tools are suitable for the task, answer directly with your best knowledge.
      
      When to Call Tools (ONLY if the tool is listed above):
      1. **Code Analysis/Review**: Use "consult_council" for complex decisions or code review.
      2. **Complex Reasoning**: Use "solve_with_voting" for validation or consensus.
      3. **Task Planning**: Use "decompose_task" for breaking down complex tasks.
      
      Error Handling:
      - If a tool returns an error or unexpected message (like "onboarding required"), DO NOT pass it to the user.
      - Instead, try a different approach or answer directly if possible.
      - NEVER call a tool that is not in the TOOLS AVAILABLE list above.
      
      CRITICAL:
      - Do not loop infinitely. If a tool fails repeatedly, stop and inform the user.
      - For questions about MCP servers, configuration files, or system architecture, answer directly.
      - If no external MCP tools are available, DO NOT attempt to call tools like "onboarding", "filesystem", "serena", etc.`
    },
    {
      role: 'user',
      content: buildFullPrompt(request.prompt, request.context)
    }
  ];

  const maxIterations = config.mcpClient.maxAgentIterations || 10;
  let iterations = 0;
  let finalResult: any = null;
  let lastToolUsed = 'orchestrator';

  while (iterations < maxIterations) {
    iterations++;
    console.error(`[LOGIC] Agent Loop Iteration ${iterations}/${maxIterations}`);

    const client = getClient();
    const response = await client.chat.completions.create({
      model: config.judgeModel,
      messages,
      tools: availableTools,
      tool_choice: 'auto',
    });

    const choice = response.choices[0];
    const message = choice.message;
    const toolCall = message.tool_calls?.[0];

    // If the model replies with text (no tool call), we treat it as the final answer
    if (!toolCall) {
      console.error('[LOGIC] Agent returned final text response.');
      finalResult = message.content;
      break;
    }

    // Add the assistant's thought/tool-call to history
    messages.push(message);

    const toolName = toolCall.function.name;
    lastToolUsed = toolName;
    let args: any = {};
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error('[LOGIC] Failed to parse tool arguments:', e);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Error: Invalid JSON arguments. Please retry with valid JSON.`
      });
      continue;
    }

    console.error(`[LOGIC] Agent calls tool: ${toolName}`, args);

    // Arg Fixes
    if (toolName.includes('get_symbols_overview') && args.file_path && !args.relative_path) {
      args.relative_path = args.file_path;
      delete args.file_path;
    }
    if (toolName.includes('search_for_pattern') && args.pattern && !args.substring_pattern) {
      args.substring_pattern = args.pattern;
      delete args.pattern;
    }

    // Execute Tool
    let toolOutput: string;
    try {
      if (internalTools.some(t => t.function.name === toolName)) {
        const result = await executeInternalTool(toolName, args);
        // Internal tools return string directly (usually markup report)
        toolOutput = typeof result === 'string' ? result : JSON.stringify(result);
      } else {
        const mcpManager = getMcpToolManager();
        if (!mcpManager) {
          // MCP tools are not available - guide the agent to use internal tools or answer directly
          toolOutput = `Error: Tool "${toolName}" is an external MCP tool, but no MCP servers are connected. ` +
            `Please use only the internal MAKER-Council tools (consult_council, solve_with_voting, decompose_task) ` +
            `or answer the user's question directly if possible.`;
        } else {
          const mcpResult = await mcpManager.executeTool({ toolName, arguments: args });
          if (mcpResult.success) {
            // Start of Content Handling Update
            if (Array.isArray(mcpResult.content)) {
              toolOutput = mcpResult.content
                .map(item => {
                  if (item.type === 'text') return item.text;
                  if (item.type === 'image') return `[Image: ${item.mimeType}]`; // Placeholder for images
                  if (item.type === 'resource') return `[Resource: ${item.resource.uri}]`; // Placeholder for resources
                  return JSON.stringify(item);
                })
                .join('\n');
            } else {
              // Fallback for unexpected content structure
              toolOutput = typeof mcpResult.content === 'string'
                ? mcpResult.content
                : JSON.stringify(mcpResult.content);
            }
            // End of Content Handling Update

          } else {
            toolOutput = `Error executing tool: ${mcpResult.error}`;
          }
        }
      }
    } catch (error) {
      toolOutput = `Error execution exception: ${String(error)}`;
    }

    console.error(`[LOGIC] Tool output length: ${toolOutput.length}`);

    // Add tool output to history so agent can see it
    messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: toolOutput
    });
  }

  if (!finalResult) {
    if (iterations >= maxIterations) {
      finalResult = "Error: Agent reached maximum iteration limit without a final answer.";
    } else {
      finalResult = "Error: Agent stopped without an answer."; // Should not happen given logic above
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;
  const raw_output_for_metadata = typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult);

  return {
    result: finalResult,
    metadata: {
      tool_used: lastToolUsed,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      performance: {
        total_time_seconds: totalTime,
      },
      raw_output: raw_output_for_metadata,
    }
  };
}

async function internalHandleConsultCouncil(query: string, num_voters?: number, k?: number): Promise<string> {
  const voters = num_voters || 3; // Default to 3 if not provided
  const model = config.voterModel;
  const temp = 0.1; // Default temperature
  const judgeModel = config.judgeModel;
  const startTime = Date.now();

  const proposalPromises = Array.from({ length: voters }, () =>
    createMessage(model, VOTER_SYSTEM_PROMPT, query, temp)
  );
  const results = await Promise.all(proposalPromises);
  const proposals = results.map(r => r.text);

  const judgePrompt = `QUESTION: "${query}"\n\nPROPOSALS:\n\n${proposals
    .map((p, i) => `--- PROPOSAL ${i + 1} ---\n${p}`)
    .join("\n\n")}`;

  const { text: judgeDecision } = await createMessage(
    judgeModel,
    JUDGE_SYSTEM_PROMPT,
    judgePrompt,
    0.2
  );

  const elapsedTime = (Date.now() - startTime) / 1000;
  const result = `# MAKER-Council Report\n\n## Final Judge's Decision\n\n${judgeDecision}\n\n---\n*Report: ${voters} voters, took ${elapsedTime.toFixed(2)}s*`;
  return result;
}

async function internalHandleSolveWithVoting(query: string, k?: number): Promise<string> {
  const { winner, state } = await firstToAheadByKVoting(
    query,
    VOTER_SYSTEM_PROMPT,
    config.voterModel,
    k || config.k,
    0.1 // Default temperature
  );
  const result = `# First-to-ahead-by-${state.votes.get(winner)} Voting Result\n\n## Winning Response\n\n${winner}\n\n---\n*Report: ${state.validSamples}/${state.totalSamples} samples valid, ${state.redFlagged} red-flagged, took ${state.elapsedTime.toFixed(2)}s*`;
  return result;
}

async function internalHandleDecomposeTask(task: string): Promise<string> {
  const { text } = await createMessage(
    config.judgeModel,
    DECOMPOSER_SYSTEM_PROMPT,
    task,
    0.1,
    config.maxTokens
  );
  return text;
}

async function executeInternalTool(toolName: string, args: any): Promise<any> {
  console.error(`[LOGIC] Executing internal tool: ${toolName}`);
  switch (toolName) {
    case 'consult_council':
      return internalHandleConsultCouncil(args.query, args.num_voters, args.k);
    case 'solve_with_voting':
      return internalHandleSolveWithVoting(args.query, args.k);
    case 'decompose_task':
      return internalHandleDecomposeTask(args.task);
    default:
      throw new Error(`Unknown internal tool: ${toolName}`);
  }
}

// ============================================================================
// MCP CLIENT INTEGRATION
// ============================================================================

// Global MCP Tool Manager instance
let mcpToolManager: McpToolManager | null = null;

/**
 * Initialize the MCP Tool Manager with configured servers
 */
export async function initializeMcpClient(): Promise<McpToolManager | null> {
  if (!config.mcpClient.enabled) {
    console.error('[MAKER] MCP Client is disabled');
    return null;
  }

  if (mcpToolManager) {
    console.error('[MAKER] MCP Client already initialized');
    return mcpToolManager;
  }

  const serverConfigs: McpServerConfig[] = config.mcpClient.servers.map(s => ({
    name: s.name,
    command: s.command,
    args: s.args,
    env: s.env,
    cwd: s.cwd,
    timeout: s.timeout || config.mcpClient.defaultTimeout,
    autoReconnect: s.autoReconnect,
  }));

  if (serverConfigs.length === 0) {
    console.error('[MAKER] No MCP servers configured');
    return null;
  }

  console.error(`[MAKER] Initializing MCP Client with ${serverConfigs.length} servers...`);

  mcpToolManager = new McpToolManager(serverConfigs);

  try {
    await mcpToolManager.initialize();
    console.error(`[MAKER] MCP Client initialized: ${mcpToolManager.getToolCount()} tools available`);
    return mcpToolManager;
  } catch (err) {
    console.error('[MAKER] Failed to initialize MCP Client:', err);
    mcpToolManager = null;
    return null;
  }
}

/**
 * Get the MCP Tool Manager instance
 */
export function getMcpToolManager(): McpToolManager | null {
  return mcpToolManager;
}

/**
 * Shutdown the MCP Tool Manager
 */
export async function shutdownMcpClient(): Promise<void> {
  if (mcpToolManager) {
    await mcpToolManager.shutdown();
    mcpToolManager = null;
  }
}


// ============================================================================
// CONFIGURATION FUNCTION (REMOVED)
// ============================================================================
// The getConfig() function has been removed. The configuration is now imported
// directly from the 'config.ts' module as a single, immutable object.
