#!/usr/bin/env node
/**
 * MAKER-Council MCP Server
 *
 * Implementação do paper "MAKER: Massively Decomposed Agentic Processes"
 * (arXiv:2511.09030v1)
 *
 * MAKER = Maximal Agentic decomposition + first-to-ahead-by-K Error correction + Red-flagging
 *
 * Componentes principais:
 * 1. MAD (Maximal Agentic Decomposition) - Decomposição em subtarefas mínimas
 * 2. First-to-ahead-by-k Voting - Sistema de votação com margem k
 * 3. Red-flagging - Descarte de respostas problemáticas
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Importar lógica do MAKER-Council e configuração
import {
  handleQuery,
  handleConsultCouncil,
  handleSolveWithVoting,
  handleDecomposeTask,
  type MakerConfig,
  type QueryRequest,
  type QueryResponse,
  type Intent,
  type ToolUsed,
  type QueryContext,
  type QueryConfig
} from './logic.js';
import { config } from './config.js';

// ============================================================================
// FERRAMENTAS MCP
// ============================================================================

const tools: Tool[] = [
  {
    name: "query",
    description: `API unificada do MAKER-Council. Ponto de entrada único que roteia automaticamente
para a ferramenta apropriada baseado no intent ou análise do prompt.

Esta é a forma RECOMENDADA de interagir com o MAKER-Council.

Parâmetros:
- prompt: A consulta principal (obrigatório)
- context: Objeto com contexto adicional (code, history, filePath)
- intent: Intenção explícita ('decision', 'code_review', 'decomposition', 'validation')
- config: Configuração (num_voters, k)

Roteamento:
- intent='decision' ou 'code_review' → consult_council
- intent='decomposition' → decompose_task
- intent='validation' → solve_with_voting
- Sem intent: infere automaticamente do prompt`,
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A consulta principal, pergunta ou tarefa a ser executada"
        },
        context: {
          type: "object",
          description: "Contexto adicional (code, history, filePath)",
          properties: {
            code: { type: "string", description: "Trecho de código relevante" },
            history: {
              type: "array",
              description: "Array de interações passadas",
              items: {
                type: "object",
                properties: {
                  role: { type: "string" },
                  content: { type: "string" }
                }
              }
            },
            filePath: { type: "string", description: "Caminho do arquivo sendo analisado" }
          }
        },
        intent: {
          type: "string",
          enum: ["decision", "code_review", "decomposition", "validation"],
          description: "Intenção explícita da requisição"
        },
        config: {
          type: "object",
          description: "Configuração de execução",
          properties: {
            num_voters: { type: "number", description: "Número de microagentes (1-10)" },
            k: { type: "number", description: "Margem de votação (1-10)" }
          }
        }
      },
      required: ["prompt"],
    },
  },
  {
    name: "consult_council",
    description: `Consulta o MAKER-Council usando o algoritmo completo do paper.

Processo:
1. Múltiplos microagentes (voters) geram propostas usando votação first-to-ahead-by-k
2. Um juiz sênior analisa as propostas e sintetiza o consenso
3. Red-flagging descarta respostas problemáticas automaticamente

Parâmetros:
- query: A questão ou código a ser analisado
- num_voters: Número de microagentes (padrão: 3)
- k: Margem de votação first-to-ahead-by-k (padrão: 3)`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A questão ou código a ser analisado" },
        num_voters: { type: "number", description: "Número de microagentes (1-10)", default: 3 },
        k: { type: "number", description: "Margem de votação (1-10)", default: 3 },
      },
      required: ["query"],
    },
  },
  {
    name: "solve_with_voting",
    description: `Resolve uma questão usando APENAS votação first-to-ahead-by-k (sem juiz).

Útil para questões com resposta objetiva onde o consenso estatístico é suficiente.
Mais rápido e barato que consult_council.

Parâmetros:
- query: A questão a ser resolvida
- k: Margem de votação (padrão: 3)`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A questão a ser resolvida" },
        k: { type: "number", description: "Margem de votação (1-10)", default: 3 },
      },
      required: ["query"],
    },
  },
  {
    name: "decompose_task",
    description: `Decompõe tarefas complexas em passos atômicos (MAD - Maximal Agentic Decomposition).

Segue a metodologia MAKER onde cada passo deve ser:
- Uma única ação verificável
- Pequeno o suficiente para um microagente executar sem confusão
- Com dependências explícitas

Retorna JSON com a decomposição estruturada.`,
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "A tarefa a ser decomposta" },
      },
      required: ["task"],
    },
  },
];

// ============================================================================
// SERVIDOR MCP
// ============================================================================

async function main() {
  // A configuração é validada e o processo pode sair se MAKER_API_KEY não existir
  // O objeto 'config' já foi validado ao ser importado de 'config.ts'

  const server = new Server(
    {
      name: "maker-council",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handler para listar ferramentas
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Handler para executar ferramentas
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: string;

      switch (name) {
        case "query": {
          const queryRequest: QueryRequest = {
            prompt: args?.prompt as string,
            context: args?.context as QueryContext | undefined,
            intent: args?.intent as Intent | undefined,
            config: args?.config as QueryConfig | undefined,
          };
          const response = await handleQuery(queryRequest);
          // Retornar como JSON formatado para a API unificada
          result = JSON.stringify(response, null, 2);
          break;
        }

        case "consult_council":
          result = await handleConsultCouncil(
            args?.query as string,
            args?.num_voters as number | undefined,
            args?.k as number | undefined
          );
          break;

        case "solve_with_voting":
          result = await handleSolveWithVoting(
            args?.query as string,
            args?.k as number | undefined
          );
          break;

        case "decompose_task":
          result = await handleDecomposeTask(
            args?.task as string
          );
          break;

        default:
          throw new Error(`Ferramenta desconhecida: ${name}`);
      }

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Erro: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  // Iniciar servidor MCP
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MAKER-Council MCP Server iniciado");
}

// Detectar modo de execução baseado em variável de ambiente ou argumento
// MAKER_MCP_MODE=true força modo MCP (usado pelo cliente MCP)
// Por padrão, quando executado diretamente (npm run dev), inicia servidor HTTP
const isMCPMode = process.env.MAKER_MCP_MODE === 'true' || process.argv.includes('--mcp');

if (isMCPMode) {
  // Modo MCP: usar stdin/stdout para comunicação com cliente MCP
  main().catch(console.error);
} else {
  // Modo standalone: iniciar servidor HTTP Express (comportamento padrão para dev)
  // Usar IIFE assíncrona com await para garantir que o processo aguarde o servidor iniciar
  (async () => {
    try {
      // await garante que o script principal espere a execução do módulo do servidor
      await import('./server.js');
    } catch (error) {
      console.error('Falha ao iniciar o servidor HTTP:', error);
      process.exit(1);
    }
  })();
}