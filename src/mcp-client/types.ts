/**
 * MCP Client Types
 * 
 * Type definitions for the MCP Client infrastructure that enables
 * the MAKER agent to connect to and use tools from other MCP servers.
 */

import { z } from 'zod';

// ============================================================================
// MCP SERVER CONFIGURATION
// ============================================================================

/**
 * Configuration for connecting to an MCP server via stdio transport
 */
export interface McpServerConfig {
  /** Unique identifier for this server */
  name: string;
  
  /** Command to execute (e.g., 'npx', 'node', 'python') */
  command: string;
  
  /** Arguments to pass to the command */
  args: string[];
  
  /** Optional environment variables for the process */
  env?: Record<string, string>;
  
  /** Optional working directory */
  cwd?: string;
  
  /** Connection timeout in milliseconds (default: 30000) */
  timeout?: number;
  
  /** Whether to automatically reconnect on disconnect */
  autoReconnect?: boolean;
}

/**
 * Schema for validating MCP server configuration
 */
export const McpServerConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  timeout: z.number().positive().default(30000),
  autoReconnect: z.boolean().default(false),
});

// ============================================================================
// MCP TOOL DEFINITIONS
// ============================================================================

/**
 * JSON Schema type for tool input parameters
 */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

/**
 * MCP Tool definition as received from an MCP server
 */
export interface McpTool {
  /** Tool name */
  name: string;
  
  /** Human-readable description */
  description?: string;
  
  /** JSON Schema for input parameters */
  inputSchema: JsonSchema;
}

/**
 * Extended tool info with server context
 */
export interface McpToolWithServer extends McpTool {
  /** Name of the server providing this tool */
  serverName: string;
  
  /** Fully qualified tool name (serverName.toolName) */
  qualifiedName: string;
}

// ============================================================================
// OPENAI-COMPATIBLE TOOL FORMAT
// ============================================================================

/**
 * OpenAI function definition format
 */
export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: JsonSchema;
}

/**
 * OpenAI tool format (function type)
 */
export interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

/**
 * OpenAI tool call format (from LLM response)
 */
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * OpenAI tool result format (for sending back to LLM)
 */
export interface OpenAIToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

// ============================================================================
// ANTHROPIC-COMPATIBLE TOOL FORMAT
// ============================================================================

/**
 * Anthropic tool definition format
 */
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: JsonSchema;
}

/**
 * Anthropic tool use block (from LLM response)
 */
export interface AnthropicToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Anthropic tool result block (for sending back to LLM)
 */
export interface AnthropicToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

/**
 * Request to execute a tool
 */
export interface ToolExecutionRequest {
  /** Qualified tool name (serverName.toolName) or just toolName */
  toolName: string;
  
  /** Arguments to pass to the tool */
  arguments: Record<string, unknown>;
  
  /** Optional timeout override in milliseconds */
  timeout?: number;
}

/**
 * Result of tool execution
 */
export interface ToolExecutionResult {
  /** Whether the execution was successful */
  success: boolean;
  
  /** Result content (if successful) */
  content?: unknown;
  
  /** Error message (if failed) */
  error?: string;
  
  /** Execution time in milliseconds */
  executionTime: number;
  
  /** Server that executed the tool */
  serverName: string;
  
  /** Tool that was executed */
  toolName: string;
}

// ============================================================================
// CONNECTION STATE
// ============================================================================

/**
 * Connection state for an MCP server
 */
export type ConnectionState = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'reconnecting';

/**
 * Connection info for an MCP server
 */
export interface ConnectionInfo {
  /** Server name */
  serverName: string;
  
  /** Current connection state */
  state: ConnectionState;
  
  /** Error message if state is 'error' */
  error?: string;
  
  /** List of available tools (when connected) */
  tools: McpTool[];
  
  /** Connection timestamp */
  connectedAt?: Date;
  
  /** Last activity timestamp */
  lastActivity?: Date;
}

// ============================================================================
// AGENT LOOP TYPES
// ============================================================================

/**
 * Message in the agent conversation
 */
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * Configuration for the agent loop
 */
export interface AgentLoopConfig {
  /** Maximum number of tool call iterations */
  maxIterations?: number;
  
  /** Whether to include tool results in final response */
  includeToolResults?: boolean;
  
  /** Timeout for each tool execution */
  toolTimeout?: number;
  
  /** Model to use for the agent */
  model?: string;
  
  /** Temperature for LLM calls */
  temperature?: number;
  
  /** Maximum tokens for LLM response */
  maxTokens?: number;
}

/**
 * Result of an agent loop execution
 */
export interface AgentLoopResult {
  /** Final response from the agent */
  response: string;
  
  /** Tools that were called during execution */
  toolsCalled: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result: ToolExecutionResult;
  }>;
  
  /** Total number of iterations */
  iterations: number;
  
  /** Total execution time in milliseconds */
  totalTime: number;
  
  /** Whether the loop completed successfully */
  success: boolean;
  
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Events emitted by the MCP client
 */
export type McpClientEvent = 
  | { type: 'connected'; serverName: string }
  | { type: 'disconnected'; serverName: string; reason?: string }
  | { type: 'error'; serverName: string; error: Error }
  | { type: 'toolsUpdated'; serverName: string; tools: McpTool[] }
  | { type: 'toolExecuted'; serverName: string; toolName: string; result: ToolExecutionResult };

/**
 * Event handler type
 */
export type McpClientEventHandler = (event: McpClientEvent) => void;