/**
 * Tool Schema Translator
 * 
 * Converts between MCP Tool definitions and LLM-compatible tool formats
 * (OpenAI and Anthropic).
 */

import type {
  McpTool,
  McpToolWithServer,
  OpenAITool,
  OpenAIFunction,
  AnthropicTool,
  JsonSchema,
} from './types.js';

/**
 * Translates MCP tool definitions to various LLM-compatible formats
 */
export class ToolSchemaTranslator {
  /**
   * Convert an MCP tool to OpenAI function format
   */
  static toOpenAITool(tool: McpTool | McpToolWithServer): OpenAITool {
    const name = 'qualifiedName' in tool ? tool.qualifiedName : tool.name;
    
    return {
      type: 'function',
      function: {
        name: this.sanitizeToolName(name),
        description: tool.description || `Tool: ${tool.name}`,
        parameters: this.normalizeJsonSchema(tool.inputSchema),
      },
    };
  }

  /**
   * Convert multiple MCP tools to OpenAI format
   */
  static toOpenAITools(tools: (McpTool | McpToolWithServer)[]): OpenAITool[] {
    return tools.map(tool => this.toOpenAITool(tool));
  }

  /**
   * Convert an MCP tool to Anthropic format
   */
  static toAnthropicTool(tool: McpTool | McpToolWithServer): AnthropicTool {
    const name = 'qualifiedName' in tool ? tool.qualifiedName : tool.name;
    
    return {
      name: this.sanitizeToolName(name),
      description: tool.description || `Tool: ${tool.name}`,
      input_schema: this.normalizeJsonSchema(tool.inputSchema),
    };
  }

  /**
   * Convert multiple MCP tools to Anthropic format
   */
  static toAnthropicTools(tools: (McpTool | McpToolWithServer)[]): AnthropicTool[] {
    return tools.map(tool => this.toAnthropicTool(tool));
  }

  /**
   * Convert OpenAI function to MCP tool format
   */
  static fromOpenAIFunction(func: OpenAIFunction, serverName?: string): McpToolWithServer {
    const toolName = func.name;
    return {
      name: toolName,
      description: func.description,
      inputSchema: func.parameters,
      serverName: serverName || 'unknown',
      qualifiedName: serverName ? `${serverName}.${toolName}` : toolName,
    };
  }

  /**
   * Sanitize tool name to be compatible with LLM APIs
   * OpenAI requires: ^[a-zA-Z0-9_-]+$
   */
  static sanitizeToolName(name: string): string {
    // Replace dots and other special chars with underscores
    return name
      .replace(/\./g, '__')  // Replace dots with double underscore
      .replace(/[^a-zA-Z0-9_-]/g, '_')  // Replace other special chars
      .replace(/^_+|_+$/g, '')  // Trim leading/trailing underscores
      .substring(0, 64);  // OpenAI has a 64 char limit
  }

  /**
   * Reverse the sanitization to get original qualified name
   */
  static unsanitizeToolName(sanitizedName: string): string {
    return sanitizedName.replace(/__/g, '.');
  }

  /**
   * Parse a qualified tool name into server and tool parts
   */
  static parseQualifiedName(qualifiedName: string): { serverName: string; toolName: string } {
    const parts = qualifiedName.split('.');
    if (parts.length >= 2) {
      return {
        serverName: parts[0],
        toolName: parts.slice(1).join('.'),
      };
    }
    return {
      serverName: '',
      toolName: qualifiedName,
    };
  }

  /**
   * Normalize JSON Schema to ensure compatibility
   */
  static normalizeJsonSchema(schema: JsonSchema): JsonSchema {
    const normalized: JsonSchema = { ...schema };

    // Ensure type is set for object schemas
    if (normalized.properties && !normalized.type) {
      normalized.type = 'object';
    }

    // Ensure required is an array
    if (normalized.required && !Array.isArray(normalized.required)) {
      normalized.required = [];
    }

    // Recursively normalize nested schemas
    if (normalized.properties) {
      const normalizedProps: Record<string, JsonSchema> = {};
      for (const [key, value] of Object.entries(normalized.properties)) {
        normalizedProps[key] = this.normalizeJsonSchema(value);
      }
      normalized.properties = normalizedProps;
    }

    // Normalize array items
    if (normalized.items) {
      normalized.items = this.normalizeJsonSchema(normalized.items);
    }

    return normalized;
  }

  /**
   * Generate a human-readable description of a tool's parameters
   */
  static describeParameters(schema: JsonSchema): string {
    if (!schema.properties) {
      return 'No parameters';
    }

    const required = new Set(schema.required || []);
    const params: string[] = [];

    for (const [name, prop] of Object.entries(schema.properties)) {
      const isRequired = required.has(name);
      const type = prop.type || 'any';
      const desc = prop.description || '';
      const reqStr = isRequired ? '(required)' : '(optional)';
      
      params.push(`  - ${name}: ${type} ${reqStr}${desc ? ` - ${desc}` : ''}`);
    }

    return params.join('\n');
  }

  /**
   * Create a tool summary for debugging/logging
   */
  static summarizeTool(tool: McpTool | McpToolWithServer): string {
    const name = 'qualifiedName' in tool ? tool.qualifiedName : tool.name;
    const params = this.describeParameters(tool.inputSchema);
    
    return `Tool: ${name}\nDescription: ${tool.description || 'N/A'}\nParameters:\n${params}`;
  }

  /**
   * Validate tool arguments against schema
   */
  static validateArguments(
    args: Record<string, unknown>,
    schema: JsonSchema
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const required = new Set(schema.required || []);

    // Check required fields
    for (const field of required) {
      if (!(field in args) || args[field] === undefined) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Check types (basic validation)
    if (schema.properties) {
      for (const [key, value] of Object.entries(args)) {
        const propSchema = schema.properties[key];
        if (propSchema && propSchema.type) {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          const expectedType = propSchema.type;
          
          // Simple type checking
          if (expectedType === 'integer' && actualType === 'number') {
            if (!Number.isInteger(value)) {
              errors.push(`Field ${key} must be an integer`);
            }
          } else if (expectedType !== actualType && expectedType !== 'any') {
            // Allow null for optional fields
            if (value !== null || required.has(key)) {
              errors.push(`Field ${key} expected ${expectedType}, got ${actualType}`);
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Merge tools from multiple servers, handling name conflicts
   */
  static mergeTools(
    toolsByServer: Map<string, McpTool[]>
  ): McpToolWithServer[] {
    const merged: McpToolWithServer[] = [];
    const seenNames = new Set<string>();

    for (const [serverName, tools] of toolsByServer) {
      for (const tool of tools) {
        const qualifiedName = `${serverName}.${tool.name}`;
        
        if (seenNames.has(qualifiedName)) {
          console.warn(`Duplicate tool name detected: ${qualifiedName}`);
          continue;
        }
        
        seenNames.add(qualifiedName);
        merged.push({
          ...tool,
          serverName,
          qualifiedName,
        });
      }
    }

    return merged;
  }
}

export default ToolSchemaTranslator;