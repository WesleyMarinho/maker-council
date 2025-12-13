/**
 * Suite de Testes End-to-End para MAKER-Council API
 * 
 * Valida que o servidor responde corretamente a qualquer tipo de prompt:
 * - Prompts simples (saudações)
 * - Perguntas diretas
 * - Tarefas de decomposição
 * - Code review
 * - Prompts enormes
 * 
 * Executar com: npm run test:e2e
 */

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const API_BASE_URL = process.env.API_URL || 'http://localhost:8338';
const API_ENDPOINT = `${API_BASE_URL}/v1/chat/completions`;
const HEALTH_ENDPOINT = `${API_BASE_URL}/health`;

// Timeout padrão para requisições (10 minutos para prompts complexos)
const DEFAULT_TIMEOUT = 600_000;

// ============================================================================
// TIPOS
// ============================================================================

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  maker_num_voters?: number;
  maker_k?: number;
}

interface ChatChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface StreamDelta {
  role?: string;
  content?: string;
}

interface StreamChoice {
  index: number;
  delta: StreamDelta;
  finish_reason: string | null;
}

interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
}

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  responseLength?: number;
  streamChunks?: number;
}

// ============================================================================
// UTILITÁRIOS
// ============================================================================

/**
 * Faz uma requisição HTTP com timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Envia uma requisição para a API (modo não-streaming)
 */
async function sendChatRequest(request: ChatRequest): Promise<{ response: ChatResponse; duration: number }> {
  const startTime = Date.now();
  
  const response = await fetchWithTimeout(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ...request, stream: false })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
  
  const data = await response.json() as ChatResponse;
  const duration = Date.now() - startTime;
  
  return { response: data, duration };
}

/**
 * Envia uma requisição para a API (modo streaming)
 */
async function sendStreamingRequest(request: ChatRequest): Promise<{ 
  content: string; 
  duration: number; 
  chunks: number 
}> {
  const startTime = Date.now();
  
  const response = await fetchWithTimeout(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ...request, stream: true })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
  
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }
  
  const decoder = new TextDecoder();
  let content = '';
  let chunks = 0;
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.substring(6).trim();
        if (data === '[DONE]') {
          continue;
        }
        try {
          const parsed = JSON.parse(data) as StreamChunk;
          if (parsed.choices?.[0]?.delta?.content) {
            content += parsed.choices[0].delta.content;
            chunks++;
          }
        } catch {
          // Ignorar chunks malformados
        }
      }
    }
  }
  
  const duration = Date.now() - startTime;
  return { content, duration, chunks };
}

/**
 * Verifica se o servidor está online
 */
async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(HEALTH_ENDPOINT, { method: 'GET' }, 5000);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Formata duração em formato legível
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
}

/**
 * Gera um prompt enorme para teste de stress
 */
function generateLargePrompt(targetWords: number = 2000): string {
  const sections = [
    `# Análise Arquitetural Completa de Sistema Enterprise

## Contexto do Projeto

Estamos desenvolvendo um sistema de e-commerce de grande escala que precisa suportar milhões de usuários simultâneos. O sistema atual é um monolito PHP legado que precisa ser migrado para uma arquitetura moderna de microserviços.

### Requisitos Funcionais

1. **Catálogo de Produtos**
   - Gerenciamento de produtos com categorias hierárquicas
   - Suporte a variantes (tamanho, cor, etc.)
   - Sistema de busca com filtros avançados
   - Recomendações personalizadas baseadas em ML

2. **Carrinho de Compras**
   - Persistência entre sessões
   - Cálculo de frete em tempo real
   - Aplicação de cupons e promoções
   - Reserva de estoque temporária

3. **Checkout e Pagamentos**
   - Múltiplos gateways de pagamento (Stripe, PayPal, PIX)
   - Split de pagamentos para marketplace
   - Retry automático em falhas
   - Detecção de fraude

4. **Gestão de Pedidos**
   - Workflow de status configurável
   - Integração com transportadoras
   - Notificações em tempo real
   - Rastreamento de entregas

5. **Sistema de Usuários**
   - Autenticação multi-fator
   - OAuth com Google, Facebook, Apple
   - Gestão de endereços
   - Histórico de compras

### Requisitos Não-Funcionais

- **Performance**: Latência p99 < 200ms para APIs críticas
- **Disponibilidade**: 99.99% uptime (menos de 52 minutos de downtime/ano)
- **Escalabilidade**: Suportar 10x o tráfego atual em Black Friday
- **Segurança**: PCI-DSS compliance para dados de cartão
- **Observabilidade**: Logs estruturados, métricas, traces distribuídos

## Arquitetura Proposta

### Camada de Apresentação

A arquitetura utiliza CDN CloudFlare na frente, seguido de Load Balancer ALB, com três BFFs: Web App Next.js, Mobile BFF Node.js e Admin BFF Node.js.

### Camada de Serviços

Cada microserviço segue o padrão hexagonal com Domain Layer (entidades, value objects, agregados), Application Layer (use cases, DTOs) e Infrastructure Layer (repositories, adapters).

### Comunicação entre Serviços

1. **Síncrona (REST/gRPC)**: Para operações que precisam de resposta imediata, com circuit breaker Resilience4j e retry com exponential backoff.

2. **Assíncrona (Kafka)**: Para eventos de domínio, com garantia de entrega at-least-once e idempotência no consumidor.

### Estratégia de Dados

Catálogo usa PostgreSQL com Redis cache e Elasticsearch para busca. Carrinho usa Redis. Pedidos e Usuários usam PostgreSQL com Redis. Pagamentos usa PostgreSQL.

### Infraestrutura

Container Orchestration com Kubernetes EKS, Service Mesh Istio, CI/CD GitHub Actions com ArgoCD, Monitoring Prometheus com Grafana, Logging ELK Stack, Tracing Jaeger.

## Perguntas para Análise

1. **Decomposição de Serviços**: A granularidade proposta está adequada?
2. **Consistência de Dados**: Como garantir consistência eventual?
3. **Estratégia de Migração**: Strangler Fig Pattern?
4. **Custo vs Benefício**: Vale a complexidade adicional?
5. **Time de Desenvolvimento**: 8 devs conseguem manter?
6. **Vendor Lock-in**: Devemos usar abstrações?
7. **Testing Strategy**: Como testar integrações?
8. **Deployment Strategy**: Blue-green, canary, ou rolling?

Por favor, analise cada aspecto e forneça recomendações detalhadas.`,

    `## Código Atual para Review

Temos um OrderService em PHP legado que precisa ser refatorado. O código atual tem os seguintes problemas:

1. **Acoplamento forte**: Dependências instanciadas no construtor
2. **Violação SRP**: Classe faz muitas coisas
3. **Sem tratamento de concorrência**: Race condition no estoque
4. **Email síncrono**: Pode falhar e não é crítico
5. **Sem idempotência**: Retry pode criar pedidos duplicados
6. **SQL injection potencial**: Queries não parametrizadas
7. **Falta de logs**: Difícil debugar problemas

O código processa pedidos incluindo validação, cálculo de total, aplicação de cupons, processamento de pagamento, criação do pedido, atualização de estoque, envio de email e limpeza do carrinho.

Preciso de uma análise completa com sugestões de refatoração para TypeScript/Node.js seguindo Clean Architecture e SOLID principles.

Considere também aspectos de testabilidade, observabilidade e resiliência. O novo código deve ser facilmente testável com mocks, ter logging estruturado, e lidar graciosamente com falhas parciais.`
  ];
  
  let result = sections.join('\n\n');
  
  // Adiciona mais conteúdo se necessário para atingir o target
  while (result.split(/\s+/).length < targetWords) {
    result += `\n\n### Consideração Adicional ${Math.random().toString(36).substring(7)}

Esta seção adicional discute aspectos importantes da arquitetura proposta, incluindo considerações sobre escalabilidade horizontal, estratégias de cache distribuído, e padrões de resiliência como circuit breakers e bulkheads. É fundamental considerar também aspectos de observabilidade, incluindo métricas de negócio, alertas proativos, e dashboards operacionais para monitoramento em tempo real.`;
  }
  
  return result;
}

// ============================================================================
// CASOS DE TESTE
// ============================================================================

interface TestCase {
  name: string;
  prompt: string;
}

const TEST_CASES: Record<string, TestCase[]> = {
  // Teste 1: Prompts Simples
  simplePrompts: [
    { name: 'Saudação simples "Oi"', prompt: 'Oi' },
    { name: 'Saudação com pergunta', prompt: 'Olá, tudo bem?' },
    { name: 'Saudação em inglês', prompt: 'Hello!' }
  ],
  
  // Teste 2: Perguntas Diretas
  directQuestions: [
    { 
      name: 'Pergunta sobre linguagens', 
      prompt: 'Qual a melhor linguagem de programação?' 
    },
    { 
      name: 'Pergunta técnica específica', 
      prompt: 'Qual a diferença entre REST e GraphQL?' 
    },
    {
      name: 'Pergunta de escolha binária',
      prompt: 'Devo usar TypeScript ou JavaScript para um projeto novo?'
    }
  ],
  
  // Teste 3: Tarefas de Decomposição
  decompositionTasks: [
    {
      name: 'Decomposição de autenticação',
      prompt: 'Como implementar um sistema de autenticação completo com JWT, refresh tokens e MFA? Decomponha em passos.'
    },
    {
      name: 'Decomposição de CI/CD',
      prompt: 'Crie um plano passo a passo para implementar CI/CD com GitHub Actions para um projeto Node.js.'
    }
  ],
  
  // Teste 4: Code Review
  codeReviews: [
    {
      name: 'Review de função com bugs',
      prompt: `Analise este código e identifique problemas:

\`\`\`javascript
async function getUserData(userId) {
  const user = await db.query("SELECT * FROM users WHERE id = " + userId);
  const password = user.password;
  console.log("User password:", password);
  
  if (user.role = "admin") {
    return { ...user, isAdmin: true };
  }
  
  return user;
}
\`\`\`

Identifique todos os bugs, vulnerabilidades de segurança e más práticas.`
    },
    {
      name: 'Review de classe complexa',
      prompt: `Revise este código TypeScript e sugira melhorias:

\`\`\`typescript
class UserService {
  private db: any;
  
  constructor() {
    this.db = new Database();
  }
  
  async createUser(data: any) {
    try {
      const user = await this.db.insert('users', data);
      await this.sendEmail(user.email, 'Welcome!');
      await this.logEvent('user_created', user.id);
      await this.updateAnalytics('new_user');
      return user;
    } catch (e) {
      console.log(e);
      return null;
    }
  }
}
\`\`\`

Sugira refatorações seguindo SOLID e Clean Architecture.`
    }
  ],
  
  // Teste 5: Prompt Enorme
  largePrompts: [
    {
      name: 'Análise arquitetural completa (~2000 palavras)',
      prompt: generateLargePrompt(2000)
    }
  ]
};

// ============================================================================
// EXECUÇÃO DOS TESTES
// ============================================================================

async function runTest(
  name: string, 
  prompt: string, 
  streaming: boolean = false
): Promise<TestResult> {
  const testName = `${name} (${streaming ? 'streaming' : 'normal'})`;
  
  try {
    const request: ChatRequest = {
      model: 'maker-council-v1',
      messages: [{ role: 'user', content: prompt }],
      maker_num_voters: 2,
      maker_k: 2
    };
    
    if (streaming) {
      const { content, duration, chunks } = await sendStreamingRequest(request);
      
      if (!content || content.length === 0) {
        throw new Error('Resposta vazia');
      }
      
      return {
        name: testName,
        passed: true,
        duration,
        responseLength: content.length,
        streamChunks: chunks
      };
    } else {
      const { response, duration } = await sendChatRequest(request);
      
      if (!response.choices?.[0]?.message?.content) {
        throw new Error('Resposta sem conteúdo');
      }
      
      const content = response.choices[0].message.content;
      
      return {
        name: testName,
        passed: true,
        duration,
        responseLength: content.length
      };
    }
  } catch (error) {
    return {
      name: testName,
      passed: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runTestSuite(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('     MAKER-Council API - Suite de Testes End-to-End');
  console.log('═'.repeat(70));
  console.log(`\n📍 API Endpoint: ${API_ENDPOINT}`);
  console.log(`⏱️  Timeout: ${formatDuration(DEFAULT_TIMEOUT)}\n`);
  
  // Verificar se o servidor está online
  console.log('🔍 Verificando servidor...');
  const isHealthy = await checkServerHealth();
  
  if (!isHealthy) {
    console.log('\n❌ Servidor não está respondendo!');
    console.log('\n💡 Para iniciar o servidor, execute:');
    console.log('   npm run serve');
    console.log(`   ou verifique se está rodando em ${API_BASE_URL}\n`);
    process.exit(1);
  }
  
  console.log('✅ Servidor online!\n');
  
  const allResults: TestResult[] = [];
  const startTime = Date.now();
  
  // Teste 1: Prompts Simples
  console.log('─'.repeat(70));
  console.log('📝 TESTE 1: Prompts Simples');
  console.log('─'.repeat(70));
  
  for (const test of TEST_CASES.simplePrompts) {
    process.stdout.write(`  ⏳ ${test.name}...`);
    const result = await runTest(test.name, test.prompt, false);
    allResults.push(result);
    
    if (result.passed) {
      console.log(`\r  ✅ ${test.name} (${formatDuration(result.duration)}, ${result.responseLength} chars)`);
    } else {
      console.log(`\r  ❌ ${test.name}: ${result.error}`);
    }
  }
  
  // Teste 2: Perguntas Diretas
  console.log('\n' + '─'.repeat(70));
  console.log('❓ TESTE 2: Perguntas Diretas');
  console.log('─'.repeat(70));
  
  for (const test of TEST_CASES.directQuestions) {
    process.stdout.write(`  ⏳ ${test.name}...`);
    const result = await runTest(test.name, test.prompt, false);
    allResults.push(result);
    
    if (result.passed) {
      console.log(`\r  ✅ ${test.name} (${formatDuration(result.duration)}, ${result.responseLength} chars)`);
    } else {
      console.log(`\r  ❌ ${test.name}: ${result.error}`);
    }
  }
  
  // Teste 3: Tarefas de Decomposição
  console.log('\n' + '─'.repeat(70));
  console.log('🔧 TESTE 3: Tarefas de Decomposição');
  console.log('─'.repeat(70));
  
  for (const test of TEST_CASES.decompositionTasks) {
    process.stdout.write(`  ⏳ ${test.name}...`);
    const result = await runTest(test.name, test.prompt, false);
    allResults.push(result);
    
    if (result.passed) {
      console.log(`\r  ✅ ${test.name} (${formatDuration(result.duration)}, ${result.responseLength} chars)`);
    } else {
      console.log(`\r  ❌ ${test.name}: ${result.error}`);
    }
  }
  
  // Teste 4: Code Review
  console.log('\n' + '─'.repeat(70));
  console.log('🔍 TESTE 4: Code Review');
  console.log('─'.repeat(70));
  
  for (const test of TEST_CASES.codeReviews) {
    process.stdout.write(`  ⏳ ${test.name}...`);
    const result = await runTest(test.name, test.prompt, false);
    allResults.push(result);
    
    if (result.passed) {
      console.log(`\r  ✅ ${test.name} (${formatDuration(result.duration)}, ${result.responseLength} chars)`);
    } else {
      console.log(`\r  ❌ ${test.name}: ${result.error}`);
    }
  }
  
  // Teste 5: Prompt Enorme
  console.log('\n' + '─'.repeat(70));
  console.log('📚 TESTE 5: Prompt Enorme (~2000 palavras)');
  console.log('─'.repeat(70));
  
  for (const test of TEST_CASES.largePrompts) {
    const wordCount = test.prompt.split(/\s+/).length;
    process.stdout.write(`  ⏳ ${test.name} (${wordCount} palavras)...`);
    const result = await runTest(test.name, test.prompt, false);
    allResults.push(result);
    
    if (result.passed) {
      console.log(`\r  ✅ ${test.name} (${formatDuration(result.duration)}, ${result.responseLength} chars)`);
    } else {
      console.log(`\r  ❌ ${test.name}: ${result.error}`);
    }
  }
  
  // Teste 6: Streaming
  console.log('\n' + '─'.repeat(70));
  console.log('🌊 TESTE 6: Modo Streaming');
  console.log('─'.repeat(70));
  
  // Testar streaming com alguns casos selecionados
  const streamingTests = [
    TEST_CASES.simplePrompts[0],
    TEST_CASES.directQuestions[0],
    TEST_CASES.decompositionTasks[0]
  ];
  
  for (const test of streamingTests) {
    process.stdout.write(`  ⏳ ${test.name} (streaming)...`);
    const result = await runTest(test.name, test.prompt, true);
    allResults.push(result);
    
    if (result.passed) {
      console.log(`\r  ✅ ${test.name} (streaming) (${formatDuration(result.duration)}, ${result.streamChunks} chunks, ${result.responseLength} chars)`);
    } else {
      console.log(`\r  ❌ ${test.name} (streaming): ${result.error}`);
    }
  }
  
  // Resumo Final
  const totalTime = Date.now() - startTime;
  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.filter(r => !r.passed).length;
  const total = allResults.length;
  
  const avgDuration = allResults
    .filter(r => r.passed)
    .reduce((sum, r) => sum + r.duration, 0) / (passed || 1);
  
  const totalChars = allResults
    .filter(r => r.passed && r.responseLength)
    .reduce((sum, r) => sum + (r.responseLength || 0), 0);
  
  console.log('\n' + '═'.repeat(70));
  console.log('                         📊 RESUMO FINAL');
  console.log('═'.repeat(70));
  
  console.log(`
  📈 Estatísticas:
     ├─ Total de testes: ${total}
     ├─ ✅ Passou: ${passed}
     ├─ ❌ Falhou: ${failed}
     ├─ Taxa de sucesso: ${((passed / total) * 100).toFixed(1)}%
     │
     ├─ ⏱️  Tempo total: ${formatDuration(totalTime)}
     ├─ ⏱️  Tempo médio por teste: ${formatDuration(avgDuration)}
     └─ 📝 Total de caracteres gerados: ${totalChars.toLocaleString()}
`);
  
  if (failed > 0) {
    console.log('  ❌ Testes que falharam:');
    allResults
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`     ├─ ${r.name}`);
        console.log(`     │  └─ ${r.error}`);
      });
    console.log('');
  }
  
  // Detalhes por categoria
  console.log('  📋 Detalhes por categoria:');
  
  const categories = [
    { name: 'Prompts Simples', tests: TEST_CASES.simplePrompts },
    { name: 'Perguntas Diretas', tests: TEST_CASES.directQuestions },
    { name: 'Decomposição', tests: TEST_CASES.decompositionTasks },
    { name: 'Code Review', tests: TEST_CASES.codeReviews },
    { name: 'Prompt Enorme', tests: TEST_CASES.largePrompts }
  ];
  
  for (const cat of categories) {
    const catResults = allResults.filter(r => 
      cat.tests.some(t => r.name.includes(t.name))
    );
    const catPassed = catResults.filter(r => r.passed).length;
    const catAvgTime = catResults
      .filter(r => r.passed)
      .reduce((sum, r) => sum + r.duration, 0) / (catPassed || 1);
    
    console.log(`     ├─ ${cat.name}: ${catPassed}/${catResults.length} (avg: ${formatDuration(catAvgTime)})`);
  }
  
  console.log('\n' + '═'.repeat(70));
  
  if (failed > 0) {
    console.log('  ⚠️  Alguns testes falharam. Verifique os erros acima.\n');
    process.exit(1);
  } else {
    console.log('  🎉 Todos os testes passaram com sucesso!\n');
    process.exit(0);
  }
}

// ============================================================================
// MAIN
// ============================================================================

runTestSuite().catch(error => {
  console.error('\n❌ Erro fatal:', error);
  process.exit(1);
});