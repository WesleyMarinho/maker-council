/**
 * Centralized Configuration Module
 *
 * Responsible for loading, validating, and providing all application
 * configurations from environment variables.
 */
import dotenv from "dotenv";

// Load variables from .env file into process.env
dotenv.config();

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

  /** Enables fast mode for simple prompts (greetings, short questions). */
  fastMode: boolean;

  /** Includes full technical report in response. If false, returns only the decision. */
  includeReport: boolean;

  /** Character limit to consider a prompt as "simple". */
  simplePromptMaxLength: number;
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

function createConfig(): Config {
  // Unify MAKER_API_URL and MAKER_BASE_URL.
  // MAKER_API_URL takes precedence.
  const apiUrl = process.env.MAKER_API_URL || process.env.MAKER_BASE_URL || 'http://localhost:8338/v1';

  // The default model can be defined by MAKER_API_MODEL.
  const defaultModel = process.env.MAKER_API_MODEL || 'gemini-3-pro-preview';

  const appConfig: Config = {
    apiKey: process.env.MAKER_API_KEY || "",
    apiUrl: apiUrl,
    judgeModel: process.env.MAKER_JUDGE_MODEL || defaultModel,
    voterModel: process.env.MAKER_VOTER_MODEL || 'gemini-2.5-flash-lite',
    k: getNumericEnv("MAKER_K", 3),
    maxTokens: getNumericEnv("MAKER_MAX_TOKENS", 16000),
    maxRounds: getNumericEnv("MAKER_MAX_ROUNDS", 10),
    port: getNumericEnv("MAKER_API_PORT", 8338),
    fastMode: getBooleanEnv("MAKER_FAST_MODE", true),
    includeReport: getBooleanEnv("MAKER_INCLUDE_REPORT", false),
    simplePromptMaxLength: getNumericEnv("MAKER_SIMPLE_PROMPT_MAX_LENGTH", 50),
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