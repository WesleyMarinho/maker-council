/**
 * MCP Client Module
 * 
 * Provides MCP Client capabilities for the MAKER-Council project,
 * enabling connection to other MCP servers, tool discovery, and execution.
 */

// Core classes
export { McpConnection } from './McpConnection.js';
export { McpToolManager } from './McpToolManager.js';
export { ToolSchemaTranslator } from './ToolSchemaTranslator.js';

// Types
export type {
  // Configuration
  McpServerConfig,
  JsonSchema,
  
  // Tools
  McpTool,
  McpToolWithServer,
  
  // OpenAI format
  OpenAITool,
  OpenAIFunction,
  OpenAIToolCall,
  OpenAIToolResult,
  
  // Anthropic format
  AnthropicTool,
  AnthropicToolUse,
  AnthropicToolResult,
  
  // Execution
  ToolExecutionRequest,
  ToolExecutionResult,
  
  // Connection
  ConnectionState,
  ConnectionInfo,
  
  // Agent loop
  AgentMessage,
  AgentLoopConfig,
  AgentLoopResult,
  
  // Events
  McpClientEvent,
  McpClientEventHandler,
} from './types.js';

// Schema validation
export { McpServerConfigSchema } from './types.js';