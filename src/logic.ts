/**
 * MAKER-Council processing logic
 * Extracts processing functions for reuse in the API server
 */

import OpenAI from "openai";
import { ChatCompletionMessageParam } from 'openai/resources/index';
import { config } from "./config.js";
export type { Config as MakerConfig } from "./config.js";
import { internalTools } from './internal-tools.js';
import { logger } from './db/logger.js';

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
export type ToolUsed = 'consult_council' | 'decompose_task' | 'solve_with_voting' | 'senior_code_review';

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

export const SENIOR_CODE_REVIEW_SYSTEM_PROMPT = `You are a Senior Code Reviewer Specialist with a skeptical, security-first mindset.
Your core philosophy is that ALL code you review is assumed to be written by a junior developer
and requires deep, thorough, and uncompromising analysis. You act as the final quality gate,
ensuring that no critical issues, security vulnerabilities, or bad practices slip through.
You combine technical rigor with educational feedback to elevate code quality and developer skills.

MANDATORY: Every review must begin with this exact sentence:
"⚠️ JUNIOR DEV CODE ALERT: This code was produced by a junior developer and requires thorough, deep analysis. I will examine every line with heightened scrutiny."

REVIEW CATEGORIES & CHECKLIST
1. Security vulnerabilities: injection, auth flaws, data exposure, input validation, dependencies, CSRF.
2. Performance & efficiency: N+1, memory leaks, O(n^2), blocking IO, concurrency issues.
3. Code quality & architecture: SOLID, DRY/KISS, design patterns, coupling/cohesion, naming.
4. Error handling & reliability: exceptions, null checks, edge cases, logging, recovery.
5. Testing & maintainability: missing tests, brittle tests, docs, config/magic values.

OUTPUT FORMAT (use exactly):
---
**⚠️ JUNIOR DEV CODE ALERT: This code was produced by a junior developer and requires thorough, deep analysis. I will examine every line with heightened scrutiny.**

### 📊 Review Summary
*Brief overview of the code quality and main findings.*

### 🔴 Critical & Major Issues
*List of severe issues that must be addressed.*
1. **[Category] Issue Name**
   - **Analysis:** Why this is a problem.
   - **Risk:** What happens if ignored.
   - **Fix:**
     \`\`\`language
     // Correct code example
     \`\`\`

### 🟡 Minor Issues & Suggestions
*List of improvements and best practices.*
1. **[Category] Issue Name**
   - **Analysis:** Explanation.
   - **Suggestion:** How to improve.

### 🎓 Educational Corner
*Pick the most interesting issue and explain the concept in depth.*

### 🏆 Code Quality Score: [X]/10
*Honest rating based on the "Junior Dev" baseline.*
---

COMMON JUNIOR MISTAKES TO WATCH FOR
- trusting client input blindly
- using print instead of logging
- hardcoding secrets
- writing happy-path-only code
- ignoring resource cleanup
- reinventing the wheel
- premature optimization vs gross inefficiency

TOOLS & TECHNIQUES
- Static analysis mental model: simulate execution flow
- Taint analysis: trace user input from source to sink
- Boundary value analysis: min, max, -1, 0, 1, null, empty`;

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

  // Log Request
  try {
    logger.logRequest({
      id: requestId,
      timestamp: new Date().toISOString(),
      tool_name: request.intent ? intentToToolName(request.intent) : 'query', // Infer tool name or generic
      prompt: request.prompt,
      intent: request.intent,
      config: JSON.stringify(request.config),
      status: 'pending',
      duration_ms: 0
    });
  } catch (e) {
    console.error('[LOGIC] Failed to log request:', e);
  }

  // Recursion Guard (Loop Prevention)
  const currentDepth = request.context?.recursionDepth || 0;
  if (currentDepth > config.maxRecursionDepth) {
    console.error(`[LOGIC] Max recursion depth reached (${currentDepth}). Aborting.`);
    const errorMsg = "Max recursion depth reached.";
    logger.updateRequestStatus(requestId, 'error', Date.now() - startTime);
    logger.log({ request_id: requestId, level: 'error', message: errorMsg });
    return {
      result: `Error: Maximum recursion depth reached. The agent loop was terminated to prevent infinite loops.`,
      metadata: {
        tool_used: 'system_error',
        request_id: requestId,
        timestamp: new Date().toISOString(),
        performance: {
          total_time_seconds: 0,
        },
        raw_output: errorMsg
      }
    };
  }

  // Fast path for simple greetings - bypass tool dispatcher
  if (isSimpleGreeting(request.prompt)) {
    console.error('[LOGIC] Simple greeting detected. Bypassing tool dispatcher.');
    const duration = Date.now() - startTime;
    const totalTime = duration / 1000;
    
    logger.updateRequestStatus(requestId, 'success', duration);
    logger.logResponse({
      request_id: requestId,
      timestamp: new Date().toISOString(),
      result: "Hello! How can I help you today?",
      metadata: JSON.stringify({ tool_used: 'none' })
    });

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

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are a high-level orchestration agent (MAKER-Council).
      
      GOAL: Resolve the user's request efficiently using available tools.

      TOOLS AVAILABLE (use ONLY these):
      ${internalTools.map(t => `- ${t.function.name}: ${(t.function.description || '').split('\n')[0]}`).join('\n')}
      
      IMPORTANT - When to Answer Directly:
      1. **General Knowledge**: For factual questions you can answer, respond directly.
      2. **After Tool Execution**: Once you have the information from a tool, formulate the final answer yourself.
      3. **No Suitable Tool**: If none of the available tools are suitable for the task, answer directly with your best knowledge.
      
      When to Call Tools (ONLY if the tool is listed above):
      1. **Code Analysis/Review**: Use "consult_council" for complex decisions or code review.
      2. **Complex Reasoning**: Use "solve_with_voting" for validation or consensus.
      3. **Task Planning**: Use "decompose_task" for breaking down complex tasks.
      
      CRITICAL:
      - Do not loop infinitely. If a tool fails repeatedly, stop and inform the user.`
    },
    {
      role: 'user',
      content: buildFullPrompt(request.prompt, request.context)
    }
  ];

  const maxIterations = 10;
  let iterations = 0;
  let finalResult: any = null;
  let lastToolUsed = 'orchestrator';

  while (iterations < maxIterations) {
    iterations++;

    const client = getClient();
    const response = await client.chat.completions.create({
      model: config.judgeModel,
      messages,
      tools: internalTools,
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
    const toolCallId = generateRequestId();
    const toolStartTime = Date.now();
    let toolOutput: string;
    let toolError: string | undefined;

    try {
      if (internalTools.some(t => t.function.name === toolName)) {
        const result = await executeInternalTool(toolName, args);
        // Internal tools return string directly (usually markup report)
        toolOutput = typeof result === 'string' ? result : JSON.stringify(result);
      } else {
        toolOutput = `Error: Unknown tool "${toolName}". Only internal tools are available.`;
        toolError = `Unknown tool: ${toolName}`;
      }
    } catch (error) {
      toolError = String(error);
      toolOutput = `Error execution exception: ${toolError}`;
    }

    const toolDuration = Date.now() - toolStartTime;
    try {
      logger.logToolCall({
        id: toolCallId,
        request_id: requestId,
        timestamp: new Date().toISOString(),
        tool_name: toolName,
        arguments: JSON.stringify(args),
        output: toolOutput,
        error: toolError,
        duration_ms: toolDuration
      });
    } catch (e) {
      console.error('[LOGIC] Failed to log tool call:', e);
    }

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

  const duration = Date.now() - startTime;
  const totalTime = duration / 1000;
  const raw_output_for_metadata = typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult);

  logger.updateRequestStatus(requestId, 'success', duration);
  logger.logResponse({
    request_id: requestId,
    timestamp: new Date().toISOString(),
    result: raw_output_for_metadata,
    metadata: JSON.stringify({ tool_used: lastToolUsed, performance: { total_time_seconds: totalTime } })
  });

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

function intentToToolName(intent: Intent): string {
  switch (intent) {
    case 'decision': return 'consult_council';
    case 'code_review': return 'consult_council';
    case 'decomposition': return 'decompose_task';
    case 'validation': return 'solve_with_voting';
    default: return 'unknown';
  }
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

async function internalHandleSeniorCodeReview(
  code: string,
  language?: string,
  context?: string,
  focusAreas?: string[]
): Promise<string> {
  const promptParts: string[] = [];

  if (language) {
    promptParts.push(`Language: ${language}`);
  }

  if (context) {
    promptParts.push(`Context: ${context}`);
  }

  if (focusAreas && focusAreas.length > 0) {
    promptParts.push(`Focus areas: ${focusAreas.join(', ')}`);
  }

  const codeLanguage = language || 'text';
  promptParts.push(`Code:\n\n\`\`\`${codeLanguage}\n${code}\n\`\`\``);

  const userPrompt = promptParts.join('\n\n');

  const { text } = await createMessage(
    config.judgeModel,
    SENIOR_CODE_REVIEW_SYSTEM_PROMPT,
    userPrompt,
    0.2,
    config.maxTokens
  );

  return text;
}

export async function handleSeniorCodeReview(
  code: string,
  language?: string,
  context?: string,
  focusAreas?: string[]
): Promise<string> {
  return internalHandleSeniorCodeReview(code, language, context, focusAreas);
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
  switch (toolName) {
    case 'consult_council':
      return internalHandleConsultCouncil(args.query, args.num_voters, args.k);
    case 'senior_code_review':
      return internalHandleSeniorCodeReview(
        args.code,
        args.language,
        args.context,
        args.focus_areas
      );
    case 'solve_with_voting':
      return internalHandleSolveWithVoting(args.query, args.k);
    case 'decompose_task':
      return internalHandleDecomposeTask(args.task);
    default:
      throw new Error(`Unknown internal tool: ${toolName}`);
  }
}



// ============================================================================
// CONFIGURATION FUNCTION (REMOVED)
// ============================================================================
// The getConfig() function has been removed. The configuration is now imported
// directly from the 'config.ts' module as a single, immutable object.
