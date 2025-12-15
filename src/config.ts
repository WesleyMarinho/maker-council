/**
 * Centralized Configuration Module
 *
 * Responsible for loading, validating, and providing all application
 * configurations from environment variables.
 */
import dotenv from "dotenv";

// Load variables from .env file into process.env
const result = dotenv.config();

// Only log dotenv errors, not success (reduce noise in production)
if (result.error) {
  console.error('[CONFIG] Warning: dotenv.config() failed:', result.error.message);
  console.error('[CONFIG] Environment variables may not be loaded from .env file');
}

/**
 * Configuration for an MCP server connection
 */
export interface McpServerDefinition {
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
  
  /** Connection timeout in milliseconds */
  timeout?: number;
  
  /** Whether to automatically reconnect on disconnect */
  autoReconnect?: boolean;
}

/**
 * Interface that defines the configuration object structure.
 * Ensures strong typing for all environment variables used.
 */
export interface Config {
  /** API key for the MAKER service. Essential for authentication. */
  apiKey: string;

  /** Base URL for the MAKER API. */
  apiUrl: string;

  /** Language model to be used by the Senior Judge. */
  judgeModel: string;

  /** Language model to be used by Microagents (Voters). */
  voterModel: string;

  /** Voting margin 'k' for the first-to-ahead-by-k algorithm. */
  k: number;

  /** Maximum number of tokens for LLM-generated responses. */
  maxTokens: number;

  /** Maximum number of voting rounds before forcing a decision. */
  maxRounds: number;
  
  /** Port on which the API server will listen. */
  port: number;

  /** Force MCP mode (stdin/stdout communication instead of HTTP server). */
  mcpMode: boolean;

  /** Enables fast mode for simple prompts (greetings, short questions). */
  fastMode: boolean;

  /** Includes full technical report in response. If false, returns only the decision. */
  includeReport: boolean;

  /** Character limit to consider a prompt as "simple". */
  simplePromptMaxLength: number;

  /** MCP Client configuration */
  mcpClient: {
    /** Whether to enable MCP client functionality */
    enabled: boolean;
    
    /** List of MCP servers to connect to */
    servers: McpServerDefinition[];
    
    /** Default timeout for tool execution (ms) */
    defaultTimeout: number;
    
    /** Maximum iterations in agent loop */
    maxAgentIterations: number;
  };
}

/**
 * Helper function to read and convert a numeric environment variable.
 * @param envVar - The environment variable name.
 * @param defaultValue - The default value to use if the variable is not defined or invalid.
 * @returns The numeric value of the variable or the default.
 */
function getNumericEnv(envVar: string, defaultValue: number): number {
  const value = process.env[envVar];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Function to read, validate, and build the configuration object.
 * @returns An immutable configuration object.
 */
/**
 * Helper function to read a boolean environment variable.
 * @param envVar - The environment variable name.
 * @param defaultValue - The default value to use if the variable is not defined.
 * @returns The boolean value of the variable or the default.
 */
function getBooleanEnv(envVar: string, defaultValue: boolean): boolean {
  const value = process.env[envVar];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse MCP servers from environment variable.
 * Format: MAKER_MCP_SERVERS='[{"name":"server1","command":"npx","args":["-y","@some/mcp-server"]}]'
 * Or a simpler format: MAKER_MCP_SERVERS='server1:npx:-y:@some/mcp-server;server2:node:./server.js'
 */
function parseMcpServers(): McpServerDefinition[] {
  const serversEnv = process.env.MAKER_MCP_SERVERS;
  if (!serversEnv) {
    return [];
  }

  try {
    // Try JSON format first
    if (serversEnv.trim().startsWith('[')) {
      return JSON.parse(serversEnv) as McpServerDefinition[];
    }

    // Simple format: name:command:arg1:arg2;name2:command2:arg1
    const servers: McpServerDefinition[] = [];
    const serverDefs = serversEnv.split(';').filter(s => s.trim());
    
    for (const def of serverDefs) {
      const parts = def.split(':').map(p => p.trim());
      if (parts.length >= 2) {
        const [name, command, ...args] = parts;
        servers.push({
          name,
          command,
          args,
          timeout: getNumericEnv('MAKER_MCP_TIMEOUT', 30000),
          autoReconnect: getBooleanEnv('MAKER_MCP_AUTO_RECONNECT', false),
        });
      }
    }
    
    return servers;
  } catch (err) {
    console.error('Failed to parse MAKER_MCP_SERVERS:', err);
    return [];
  }
}

function createConfig(): Config {
  // Unify MAKER_API_URL and MAKER_BASE_URL.
  // MAKER_API_URL takes precedence.
  // IMPORTANT: Default to OpenAI API to avoid self-referencing loop
  // (the server runs on port 8338, so we must NOT default to that)
  const apiUrl = process.env.MAKER_API_URL || process.env.MAKER_BASE_URL || 'https://api.openai.com/v1';

  // The default model can be defined by MAKER_API_MODEL.
  const defaultModel = process.env.MAKER_API_MODEL || 'gpt-4o-mini';

  const appConfig: Config = {
    apiKey: process.env.MAKER_API_KEY || "",
    apiUrl: apiUrl,
    judgeModel: process.env.MAKER_JUDGE_MODEL || defaultModel,
    voterModel: process.env.MAKER_VOTER_MODEL || 'gpt-4o-mini',
    k: getNumericEnv("MAKER_K", 3),
    maxTokens: getNumericEnv("MAKER_MAX_TOKENS", 16000),
    maxRounds: getNumericEnv("MAKER_MAX_ROUNDS", 10),
    port: getNumericEnv("MAKER_API_PORT", 8338),
    mcpMode: getBooleanEnv("MAKER_MCP_MODE", false),
    fastMode: getBooleanEnv("MAKER_FAST_MODE", true),
    includeReport: getBooleanEnv("MAKER_INCLUDE_REPORT", false),
    simplePromptMaxLength: getNumericEnv("MAKER_SIMPLE_PROMPT_MAX_LENGTH", 50),
    mcpClient: {
      enabled: getBooleanEnv("MAKER_MCP_CLIENT_ENABLED", false),
      servers: parseMcpServers(),
      defaultTimeout: getNumericEnv("MAKER_MCP_TIMEOUT", 30000),
      maxAgentIterations: getNumericEnv("MAKER_MCP_MAX_ITERATIONS", 10),
    },
  };

  // Critical validation: the API key is required.
  if (!appConfig.apiKey) {
    console.error("Critical Error: The MAKER_API_KEY environment variable is not defined.");
    console.error("The application cannot start without an API key.");
    process.exit(1);
  }

  // Freeze the object to make it immutable during the application lifecycle.
  return Object.freeze(appConfig);
}

// Export a single immutable instance of the configuration.
export const config = createConfig();