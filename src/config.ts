/**
 * Centralized Configuration Module
 *
 * Responsible for loading, validating, and providing all application
 * configurations from environment variables.
 */
import dotenv from "dotenv";

// Load variables from .env file into process.env
// Load variables from .env file into process.env
const result = dotenv.config();

// Only log dotenv errors, not success (reduce noise in production)
if (result.error) {
  console.error('[CONFIG] Warning: dotenv.config() failed:', result.error.message);
  console.error('[CONFIG] Environment variables may not be loaded from .env file');
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

  /** Maximum recursion depth for nested agent calls (loop prevention) */
  maxRecursionDepth: number;
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
function createConfig(): Config {
  // Unify MAKER_API_URL and MAKER_BASE_URL.
  // MAKER_API_URL takes precedence.
  // IMPORTANT: Default to OpenAI API to avoid self-referencing loop
  // (the server runs on port 8338, so we must NOT default to that)
  let apiUrl = (process.env.MAKER_API_URL || process.env.MAKER_BASE_URL || 'https://api.openai.com/v1').trim();

  // Ensure the base URL has a trailing slash, as the SDK might not join paths correctly otherwise.
  if (apiUrl && !apiUrl.endsWith('/')) {
    apiUrl += '/';
  }

  // The default model can be defined by MAKER_API_MODEL.
  // Using gpt-4o-mini as default since it's widely supported by OpenAI-compatible APIs
  const defaultModel = process.env.MAKER_API_MODEL || 'gpt-4o-mini';

  const appConfig: Config = {
    apiKey: process.env.MAKER_API_KEY || "",
    apiUrl: apiUrl,
    // Judge model: use a capable model for complex reasoning
    // Falls back to default model if not specified
    judgeModel: process.env.MAKER_JUDGE_MODEL || defaultModel,
    // Voter model: can be faster/cheaper since multiple calls are made
    // Falls back to gpt-4o-mini which is widely supported
    voterModel: process.env.MAKER_VOTER_MODEL || defaultModel,
    k: getNumericEnv("MAKER_K", 3),
    maxTokens: getNumericEnv("MAKER_MAX_TOKENS", 16000),
    maxRounds: getNumericEnv("MAKER_MAX_ROUNDS", 10),
    maxRecursionDepth: getNumericEnv("MAKER_MAX_RECURSION_DEPTH", 5),
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