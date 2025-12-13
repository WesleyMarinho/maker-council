/**
 * Servidor API compatível com OpenAI para MAKER-Council
 * Expõe o endpoint /v1/chat/completions usando a lógica do MAKER-Council
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import {
  handleQuery,
  QueryRequest,
  QueryResponse
} from './logic.js';
import { config } from './config.js';

// A porta agora é obtida diretamente do objeto de configuração
const PORT = config.port;
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '500mb' }));
app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));

// Interface para requisição OpenAI Chat Completions
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: any;
}

interface OpenAIRequest {
  model?: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  user?: string;
  // Parâmetros customizados do MAKER-Council
  maker_intent?: 'decision' | 'code_review' | 'decomposition' | 'validation';
  maker_num_voters?: number;
  maker_k?: number;
}

// Interface para resposta OpenAI Chat Completions
interface OpenAIChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: 'stop' | 'length' | 'function_call' | 'content_filter';
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

// Helper para gerar ID único no estilo OpenAI
function generateOpenAIId(): string {
  return `chatcmpl-${Date.now()}`;
}

// Extrai a última mensagem do usuário do array de mensagens
function extractLastUserMessage(messages: OpenAIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const content = messages[i].content;
      
      if (typeof content === 'string') {
        return content;
      }
      
      if (Array.isArray(content)) {
        // Extrair texto de partes do tipo 'text'
        return content
          .filter((part: any) => part?.type === 'text' && part?.text)
          .map((part: any) => part.text)
          .join('\n');
      }

      // Conteúdo nulo ou indefinido (use string vazia como fallback)
      return '';
    }
  }
  throw new Error('Nenhuma mensagem de usuário encontrada');
}

// Função auxiliar para enviar chunks SSE
function sendSSEChunk(res: express.Response, data: any): void {
  const chunk = `data: ${JSON.stringify(data)}\n\n`;
  res.write(chunk);
}

// Função para quebrar texto em chunks de palavras
function* chunkByWords(text: string, chunkSize: number = 5): Generator<string> {
  const words = text.split(' ');
  for (let i = 0; i < words.length; i += chunkSize) {
    yield words.slice(i, i + chunkSize).join(' ');
  }
}

// Endpoint principal - Chat Completions
app.post('/v1/chat/completions', async (req, res) => {
  try {
    console.log('\n[DEBUG] ========== NOVA REQUISIÇÃO ==========');
    console.log('[DEBUG] Request body:', JSON.stringify(req.body, null, 2));
    console.log('[DEBUG] Messages array:', JSON.stringify(req.body.messages, null, 2));
    console.log('[DEBUG] Stream mode:', req.body.stream);
    
    // Validar requisição
    const openaiReq: OpenAIRequest = req.body;
    
    if (!openaiReq.messages || !Array.isArray(openaiReq.messages)) {
      console.log('[DEBUG] ERRO: messages não é um array válido');
      return res.status(400).json({
        error: {
          message: 'O campo "messages" é obrigatório e deve ser um array',
          type: 'invalid_request_error',
          param: 'messages'
        }
      });
    }

    // Extrair última mensagem do usuário
    const userMessage = extractLastUserMessage(openaiReq.messages);
    console.log('[DEBUG] Extracted userMessage:', userMessage);
    console.log('[DEBUG] userMessage length:', userMessage.length);
    
    // Construir requisição para o MAKER-Council
    const queryRequest: QueryRequest = {
      prompt: userMessage,
      intent: openaiReq.maker_intent,
      config: {
        num_voters: openaiReq.maker_num_voters,
        k: openaiReq.maker_k
      }
    };
    console.log('[DEBUG] QueryRequest construído:', JSON.stringify(queryRequest, null, 2));

    // Adicionar contexto se houver mensagens anteriores
    if (openaiReq.messages.length > 1) {
      queryRequest.context = {
        history: openaiReq.messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      };
      console.log('[DEBUG] Contexto adicionado com', openaiReq.messages.length, 'mensagens');
    }

    // Processar com o MAKER-Council usando o objeto de configuração importado
    console.log('[DEBUG] Chamando handleQuery...');
    const response: QueryResponse = await handleQuery(queryRequest);
    console.log('[DEBUG] Resposta do handleQuery:', JSON.stringify(response, null, 2).substring(0, 500) + '...');

    // Verificar se o cliente solicitou streaming
    if (openaiReq.stream === true) {
      console.log('[DEBUG] Modo STREAMING ativado');
      // Configurar headers para Server-Sent Events (SSE)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      const id = generateOpenAIId();
      const created = Math.floor(Date.now() / 1000);
      const model = openaiReq.model || 'maker-council-v1';
      
      // Obter o conteúdo da resposta como string
      const content = typeof response.result === 'string'
        ? response.result
        : JSON.stringify(response.result, null, 2);
      
      console.log('[DEBUG] Conteúdo para streaming (primeiros 200 chars):', content.substring(0, 200));
      console.log('[DEBUG] Conteúdo total length:', content.length);
      
      // Enviar o chunk inicial com a role
      console.log('[DEBUG] Enviando chunk inicial...');
      sendSSEChunk(res, {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null
        }]
      });
      
      // Enviar o conteúdo em chunks de palavras
      for (const chunk of chunkByWords(content, 3)) {
        sendSSEChunk(res, {
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{
            index: 0,
            delta: { content: chunk + ' ' },
            finish_reason: null
          }]
        });
        
        // Pequeno delay para simular streaming real
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      
      // Enviar o chunk final com finish_reason
      console.log('[DEBUG] Enviando chunk final...');
      sendSSEChunk(res, {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop'
        }]
      });
      
      // Enviar o marcador [DONE]
      console.log('[DEBUG] Enviando [DONE]...');
      res.write('data: [DONE]\n\n');
      res.end();
      console.log('[DEBUG] Streaming finalizado com sucesso');
      
    } else {
      console.log('[DEBUG] Modo NÃO-STREAMING');
      // Resposta não-streaming (lógica original)
      const openaiResponse: OpenAIResponse = {
        id: generateOpenAIId(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: openaiReq.model || 'maker-council-v1',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: typeof response.result === 'string'
              ? response.result
              : JSON.stringify(response.result, null, 2)
          },
          finish_reason: 'stop'
        }]
      };

      // Adicionar informações de uso (estimado)
      const promptTokens = Math.ceil(
        openaiReq.messages.reduce((sum, msg) => {
          if (typeof msg.content === 'string') return sum + msg.content.length;
          if (Array.isArray(msg.content)) return sum + JSON.stringify(msg.content).length;
          return sum;
        }, 0) / 4
      );
      const completionTokens = Math.ceil(
        (typeof response.result === 'string' ? response.result : JSON.stringify(response.result)).length / 4
      );
      
      openaiResponse.usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      };

      // Adicionar headers específicos do OpenAI
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      res.json(openaiResponse);
    }

  } catch (error) {
    console.error('[Server] Erro no endpoint /v1/chat/completions:', error);
    
    // Se estiver em modo de streaming, enviar erro via SSE
    if (req.body?.stream === true && !res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      sendSSEChunk(res, {
        error: {
          message: error instanceof Error ? error.message : 'Erro interno do servidor',
          type: 'server_error',
          code: 'internal_error'
        }
      });
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // Retornar erro no formato OpenAI
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Erro interno do servidor',
          type: 'server_error',
          code: 'internal_error'
        }
      });
    }
  }
});

// Endpoint de health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Endpoint para listar modelos disponíveis (compatibilidade OpenAI)
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: 'maker-council-v1',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'maker-council'
      }
    ]
  });
});

// Middleware para rotas não encontradas
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Rota não encontrada: ${req.method} ${req.originalUrl}`,
      type: 'invalid_request_error',
      code: 'not_found'
    }
  });
});

// Tratamento global de erros
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server] Erro não tratado:', err);
  res.status(500).json({
    error: {
      message: 'Erro interno do servidor',
      type: 'server_error',
      code: 'internal_error'
    }
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 MAKER-Council API Server iniciado na porta ${PORT}`);
  console.log(`📍 Endpoint: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📚 Models: http://localhost:${PORT}/v1/models`);
  console.log('\n⚙️  Configuração:');
  console.log(`   - LLM Provider URL: ${config.apiUrl}`);
  console.log(`   - Judge Model: ${config.judgeModel}`);
  console.log(`   - Voter Model: ${config.voterModel}`);
  console.log(`   - K (voting margin): ${config.k}`);
  console.log(`   - Max Tokens: ${config.maxTokens}`);
  console.log(`   - Fast Mode: ${config.fastMode}`);
  console.log(`   - Simple Prompt Max Length: ${config.simplePromptMaxLength}`);
  console.log(`   - Include Report: ${config.includeReport}`);
  if (config.apiUrl.includes(`:${PORT}`)) {
    console.log('\n⚠️  AVISO: LLM Provider URL contém a mesma porta do servidor!');
    console.log('   Isso pode causar loop infinito. Verifique MAKER_BASE_URL no .env');
  }
  console.log('\n💡 Para testar com curl:');
  console.log(`curl -X POST http://localhost:${PORT}/v1/chat/completions \\`);
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -d \'{"messages": [{"role": "user", "content": "Qual é a melhor abordagem para autenticação em APIs?"}]}\'');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 Recebido SIGTERM, encerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Recebido SIGINT, encerrando servidor...');
  process.exit(0);
});