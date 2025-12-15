/**
 * MCP Connection
 * 
 * Handles individual StdioClientTransport connections to MCP servers.
 * Wraps the MCP SDK client with connection lifecycle management.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  McpServerConfig,
  McpTool,
  ConnectionState,
  ConnectionInfo,
  ToolExecutionResult,
  McpClientEvent,
  McpClientEventHandler,
} from './types.js';

/**
 * Manages a single connection to an MCP server
 */
export class McpConnection {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private state: ConnectionState = 'disconnected';
  private tools: McpTool[] = [];
  private connectedAt: Date | null = null;
  private lastActivity: Date | null = null;
  private error: string | null = null;
  private eventHandlers: Set<McpClientEventHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000;

  constructor(private readonly config: McpServerConfig) {}

  /**
   * Get the server name
   */
  get serverName(): string {
    return this.config.name;
  }

  /**
   * Get current connection state
   */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): ConnectionInfo {
    return {
      serverName: this.config.name,
      state: this.state,
      error: this.error || undefined,
      tools: [...this.tools],
      connectedAt: this.connectedAt || undefined,
      lastActivity: this.lastActivity || undefined,
    };
  }

  /**
   * Get available tools
   */
  getTools(): McpTool[] {
    return [...this.tools];
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected';
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
        console.error(`[McpConnection] Event handler error:`, err);
      }
    }
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      console.error(`[McpConnection] Already ${this.state} to ${this.config.name}`);
      return;
    }

    this.state = 'connecting';
    this.error = null;

    try {
      console.error(`[McpConnection] Connecting to ${this.config.name}...`);
      console.error(`[McpConnection] Command: ${this.config.command} ${this.config.args.join(' ')}`);

      // Create the stdio transport
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env,
        cwd: this.config.cwd,
      });

      // Create the client
      this.client = new Client(
        {
          name: `maker-council-client`,
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      // Connect with timeout
      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), this.config.timeout || 30000);
      });

      await Promise.race([connectPromise, timeoutPromise]);

      this.state = 'connected';
      this.connectedAt = new Date();
      this.lastActivity = new Date();
      this.reconnectAttempts = 0;

      console.error(`[McpConnection] Connected to ${this.config.name}`);

      // Discover tools
      await this.discoverTools();

      this.emit({ type: 'connected', serverName: this.config.name });

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[McpConnection] Failed to connect to ${this.config.name}:`, errorMessage);
      
      this.state = 'error';
      this.error = errorMessage;
      
      this.emit({ 
        type: 'error', 
        serverName: this.config.name, 
        error: err instanceof Error ? err : new Error(errorMessage) 
      });

      // Attempt reconnect if configured
      if (this.config.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }

      throw err;
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    this.state = 'reconnecting';
    
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.error(`[McpConnection] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // Error already handled in connect()
      }
    }, delay);
  }

  /**
   * Discover available tools from the server
   */
  async discoverTools(): Promise<McpTool[]> {
    if (!this.client || this.state !== 'connected') {
      throw new Error('Not connected');
    }

    try {
      console.error(`[McpConnection] Discovering tools from ${this.config.name}...`);
      
      const response = await this.client.listTools();
      
      this.tools = (response.tools || []).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));

      this.lastActivity = new Date();
      
      console.error(`[McpConnection] Discovered ${this.tools.length} tools from ${this.config.name}`);
      
      this.emit({ 
        type: 'toolsUpdated', 
        serverName: this.config.name, 
        tools: this.tools 
      });

      return this.tools;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[McpConnection] Failed to discover tools from ${this.config.name}:`, errorMessage);
      throw err;
    }
  }

  /**
   * Execute a tool on this server
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    timeout?: number
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    if (!this.client || this.state !== 'connected') {
      return {
        success: false,
        error: 'Not connected to server',
        executionTime: Date.now() - startTime,
        serverName: this.config.name,
        toolName,
      };
    }

    // Verify tool exists
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolName}' not found on server '${this.config.name}'`,
        executionTime: Date.now() - startTime,
        serverName: this.config.name,
        toolName,
      };
    }

    try {
      console.error(`[McpConnection] Executing tool ${toolName} on ${this.config.name}`);
      console.error(`[McpConnection] Arguments:`, JSON.stringify(args));

      // Execute with timeout
      const executePromise = this.client.callTool({
        name: toolName,
        arguments: args,
      });

      const effectiveTimeout = timeout || this.config.timeout || 30000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Tool execution timeout')), effectiveTimeout);
      });

      const response = await Promise.race([executePromise, timeoutPromise]);
      
      this.lastActivity = new Date();

      // Extract content from response
      let content: unknown;
      if (response.content && Array.isArray(response.content)) {
        // MCP returns content as array of content blocks
        const textContent = response.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map(c => c.text)
          .join('\n');
        content = textContent || response.content;
      } else {
        content = response.content;
      }

      const result: ToolExecutionResult = {
        success: !response.isError,
        content,
        error: response.isError ? String(content) : undefined,
        executionTime: Date.now() - startTime,
        serverName: this.config.name,
        toolName,
      };

      console.error(`[McpConnection] Tool ${toolName} executed in ${result.executionTime}ms`);
      
      this.emit({
        type: 'toolExecuted',
        serverName: this.config.name,
        toolName,
        result,
      });

      return result;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[McpConnection] Tool execution failed:`, errorMessage);

      const result: ToolExecutionResult = {
        success: false,
        error: errorMessage,
        executionTime: Date.now() - startTime,
        serverName: this.config.name,
        toolName,
      };

      this.emit({
        type: 'toolExecuted',
        serverName: this.config.name,
        toolName,
        result,
      });

      return result;
    }
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (this.state === 'disconnected') {
      return;
    }

    console.error(`[McpConnection] Disconnecting from ${this.config.name}...`);

    try {
      if (this.client) {
        await this.client.close();
      }
    } catch (err) {
      console.error(`[McpConnection] Error during disconnect:`, err);
    }

    this.client = null;
    this.transport = null;
    this.state = 'disconnected';
    this.tools = [];
    this.connectedAt = null;

    this.emit({ 
      type: 'disconnected', 
      serverName: this.config.name,
      reason: 'Manual disconnect',
    });

    console.error(`[McpConnection] Disconnected from ${this.config.name}`);
  }

  /**
   * Reconnect to the server
   */
  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }
}

export default McpConnection;