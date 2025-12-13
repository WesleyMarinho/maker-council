/**
 * Módulo de Configuração Centralizado
 *
 * Responsável por carregar, validar e fornecer todas as configurações
 * da aplicação a partir de variáveis de ambiente.
 */
import dotenv from "dotenv";

// Carrega as variáveis do arquivo .env para process.env
dotenv.config();

/**
 * Interface que define a estrutura do objeto de configuração.
 * Garante tipagem forte para todas as variáveis de ambiente usadas.
 */
export interface Config {
  /** Chave de API para o serviço MAKER. Essencial para autenticação. */
  apiKey: string;

  /** URL base para a API do MAKER. */
  apiUrl: string;

  /** Modelo de linguagem a ser usado pelo Juiz Sênior. */
  judgeModel: string;

  /** Modelo de linguagem a ser usado pelos Microagentes (Voters). */
  voterModel: string;

  /** Margem de votação 'k' para o algoritmo first-to-ahead-by-k. */
  k: number;

  /** Número máximo de tokens para as respostas geradas pela LLM. */
  maxTokens: number;

  /** Número máximo de rodadas de votação antes de forçar uma decisão. */
  maxRounds: number;
  
  /** Porta em que o servidor da API irá escutar. */
  port: number;

  /** Habilita modo rápido para prompts simples (saudações, perguntas curtas). */
  fastMode: boolean;

  /** Inclui relatório técnico completo na resposta. Se false, retorna apenas a decisão. */
  includeReport: boolean;

  /** Limite de caracteres para considerar um prompt como "simples". */
  simplePromptMaxLength: number;
}

/**
 * Função auxiliar para ler e converter uma variável de ambiente numérica.
 * @param envVar - O nome da variável de ambiente.
 * @param defaultValue - O valor padrão a ser usado se a variável não estiver definida ou for inválida.
 * @returns O valor numérico da variável ou o padrão.
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
 * Função para ler, validar e construir o objeto de configuração.
 * @returns Um objeto de configuração imutável.
 */
/**
 * Função auxiliar para ler uma variável de ambiente booleana.
 * @param envVar - O nome da variável de ambiente.
 * @param defaultValue - O valor padrão a ser usado se a variável não estiver definida.
 * @returns O valor booleano da variável ou o padrão.
 */
function getBooleanEnv(envVar: string, defaultValue: boolean): boolean {
  const value = process.env[envVar];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

function createConfig(): Config {
  // Unifica MAKER_API_URL e MAKER_BASE_URL.
  // MAKER_API_URL tem precedência.
  const apiUrl = process.env.MAKER_API_URL || process.env.MAKER_BASE_URL || 'http://localhost:8338/v1';

  // O modelo padrão pode ser definido por MAKER_API_MODEL.
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

  // Validação crítica: a chave de API é obrigatória.
  if (!appConfig.apiKey) {
    console.error("Erro Crítico: A variável de ambiente MAKER_API_KEY não está definida.");
    console.error("A aplicação não pode iniciar sem uma chave de API.");
    process.exit(1);
  }

  // Congela o objeto para torná-lo imutável durante o ciclo de vida da aplicação.
  return Object.freeze(appConfig);
}

// Exporta uma instância única e imutável da configuração.
export const config = createConfig();