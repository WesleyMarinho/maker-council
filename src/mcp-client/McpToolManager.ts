/**
 * MCP Tool Manager
 * 
 * Manages multiple MCP server connections, provides unified tool discovery
 * and execution across all connected servers.
 */

import { McpConnection } from './McpConnection.js';
import { ToolSchemaTranslator } from './ToolSchemaTranslator.js';
import type {
  McpServerConfig,
  McpTool,
  McpToolWithServer,
  OpenAITool,
  AnthropicTool,
  ToolExecutionRequest,
  ToolExecutionResult,
  ConnectionInfo,
  McpClientEvent,
  McpClientEventHandler,
} from './types.js';

/**
 * Manager for multiple MCP server connections
 */
export class McpToolManager {
  private connections: Map<string, McpConnection> = new Map();
  private eventHandlers: Set<McpClientEventHandler> = new Set();
  private initialized = false;

  constructor(private readonly serverConfigs: McpServerConfig[] = []) {}

  /**
   * Initialize and connect to all configured servers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.error('[McpToolManager] Already initialized');
      return;
    }

    console.error(`[McpToolManager] Initializing with ${this.serverConfigs.length} servers...`);

    const connectionPromises = this.serverConfigs.map(async (config) => {
      try {
        await this.addServer(config);
      } catch (err) {
        console.error(`[McpToolManager] Failed to connect to ${config.name}:`, err);
        // Don't throw - allow partial initialization
      }
    });

    await Promise.all(connectionPromises);
    
    this.initialized = true;
    console.error(`[McpToolManager] Initialized with ${this.connections.size} active connections`);
  }

  /**
   * Add and connect to a new server
   */
  async addServer(config: McpServerConfig): Promise<void> {
    if (this.connections.has(config.name)) {
      throw new Error(`Server '${config.name}' already exists`);
    }

    const connection = new McpConnection(config);
    
    // Forward events from connection
    connection.addEventListener((event) => this.emit(event));
    
    this.connections.set(config.name, connection);
    
    await connection.connect();
  }

  /**
   * Remove and disconnect from a server
   */
  async removeServer(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`Server '${serverName}' not found`);
    }

    await connection.disconnect();
    this.connections.delete(serverName);
  }

  /**
   * Get connection info for all servers
   */
  getConnectionsInfo(): ConnectionInfo[] {
    return Array.from(this.connections.values()).map(conn => conn.getConnectionInfo());
  }

  /**
   * Get connection info for a specific server
   */
  getConnectionInfo(serverName: string): ConnectionInfo | undefined {
    return this.connections.get(serverName)?.getConnectionInfo();
  }

  /**
   * Check if a server is connected
   */
  isServerConnected(serverName: string): boolean {
    return this.connections.get(serverName)?.isConnected() ?? false;
  }

  /**
   * Get all available tools from all connected servers
   */
  getAllTools(): McpToolWithServer[] {
    const toolsByServer = new Map<string, McpTool[]>();
    
    for (const [serverName, connection] of this.connections) {
      if (connection.isConnected()) {
        toolsByServer.set(serverName, connection.getTools());
      }
    }

    return ToolSchemaTranslator.mergeTools(toolsByServer);
  }

  /**
   * Get tools from a specific server
   */
  getServerTools(serverName: string): McpTool[] {
    const connection = this.connections.get(serverName);
    if (!connection || !connection.isConnected()) {
      return [];
    }
    return connection.getTools();
  }

  /**
   * Get all tools in OpenAI format
   */
  getToolsAsOpenAI(): OpenAITool[] {
    return ToolSchemaTranslator.toOpenAITools(this.getAllTools());
  }

  /**
   * Get all tools in Anthropic format
   */
  getToolsAsAnthropic(): AnthropicTool[] {
    return ToolSchemaTranslator.toAnthropicTools(this.getAllTools());
  }

  /**
   * Find a tool by name (supports both qualified and simple names)
   */
  findTool(toolName: string): McpToolWithServer | undefined {
    const allTools = this.getAllTools();
    
    // First try exact match on qualified name
    let tool = allTools.find(t => t.qualifiedName === toolName);
    if (tool) return tool;

    // Try sanitized name match
    const unsanitized = ToolSchemaTranslator.unsanitizeToolName(toolName);
    tool = allTools.find(t => t.qualifiedName === unsanitized);
    if (tool) return tool;

    // Try simple name match (first match wins)
    tool = allTools.find(t => t.name === toolName);
    if (tool) return tool;

    // Try partial match on tool name
    const { toolName: parsedToolName } = ToolSchemaTranslator.parseQualifiedName(unsanitized);
    tool = allTools.find(t => t.name === parsedToolName);
    
    return tool;
  }

  /**
   * Execute a tool by name
   */
  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    
    // Find the tool
    const tool = this.findTool(request.toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool '${request.toolName}' not found`,
        executionTime: Date.now() - startTime,
        serverName: 'unknown',
        toolName: request.toolName,
      };
    }

    // Get the connection
    const connection = this.connections.get(tool.serverName);
    if (!connection || !connection.isConnected()) {
      return {
        success: false,
        error: `Server '${tool.serverName}' is not connected`,
        executionTime: Date.now() - startTime,
        serverName: tool.serverName,
        toolName: tool.name,
      };
    }

    // Execute the tool
    return connection.executeTool(tool.name, request.arguments, request.timeout);
  }

  /**
   * Execute a tool by qualified name (serverName.toolName)
   */
  async executeQualifiedTool(
    qualifiedName: string,
    args: Record<string, unknown>,
    timeout?: number
  ): Promise<ToolExecutionResult> {
    return this.executeTool({
      toolName: qualifiedName,
      arguments: args,
      timeout,
    });
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeToolsBatch(
    requests: ToolExecutionRequest[]
  ): Promise<ToolExecutionResult[]> {
    return Promise.all(requests.map(req => this.executeTool(req)));
  }

  /**
   * Refresh tools from all connected servers
   */
  async refreshTools(): Promise<void> {
    const refreshPromises = Array.from(this.connections.values())
      .filter(conn => conn.isConnected())
      .map(conn => conn.discoverTools().catch(err => {
        console.error(`[McpToolManager] Failed to refresh tools from ${conn.serverName}:`, err);
      }));

    await Promise.all(refreshPromises);
  }

  /**
   * Add event handler
   */
  addEventListener(handler: McpClientEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Remove event handler
   */
  removeEventListener(handler: McpClientEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: McpClientEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[McpToolManager] Event handler error:`, err);
      }
    }
  }

  /**
   * Disconnect from all servers
   */
  async shutdown(): Promise<void> {
    console.error('[McpToolManager] Shutting down...');
    
    const disconnectPromises = Array.from(this.connections.values())
      .map(conn => conn.disconnect().catch(err => {
        console.error(`[McpToolManager] Error disconnecting from ${conn.serverName}:`, err);
      }));

    await Promise.all(disconnectPromises);
    
    this.connections.clear();
    this.initialized = false;
    
    console.error('[McpToolManager] Shutdown complete');
  }

  /**
   * Get a summary of all available tools (for debugging/logging)
   */
  getToolsSummary(): string {
    const tools = this.getAllTools();
    if (tools.length === 0) {
      return 'No tools available';
    }

    const byServer = new Map<string, McpToolWithServer[]>();
    for (const tool of tools) {
      const serverTools = byServer.get(tool.serverName) || [];
      serverTools.push(tool);
      byServer.set(tool.serverName, serverTools);
    }

    const lines: string[] = [`Available tools (${tools.length} total):`];
    for (const [serverName, serverTools] of byServer) {
      lines.push(`\n  ${serverName} (${serverTools.length} tools):`);
      for (const tool of serverTools) {
        lines.push(`    - ${tool.name}: ${tool.description || 'No description'}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Check if manager has any connected servers
   */
  hasConnections(): boolean {
    return Array.from(this.connections.values()).some(conn => conn.isConnected());
  }

  /**
   * Get count of connected servers
   */
  getConnectedCount(): number {
    return Array.from(this.connections.values()).filter(conn => conn.isConnected()).length;
  }

  /**
   * Get total tool count
   */
  getToolCount(): number {
    return this.getAllTools().length;
  }
}

export default McpToolManager;