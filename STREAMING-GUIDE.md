# Guia de Streaming - MAKER-Council API

## 📋 Visão Geral

O servidor MAKER-Council agora suporta streaming (Server-Sent Events - SSE) no endpoint `/v1/chat/completions`. Isso permite que clientes recebam respostas em tempo real, palavra por palavra, melhorando a experiência do usuário.

## 🚀 Como Usar

### 1. Requisição com Streaming

Para ativar o streaming, inclua `"stream": true` na sua requisição:

```json
{
  "model": "maker-council-v1",
  "messages": [
    { "role": "user", "content": "Explique como funciona o algoritmo de votação MAKER-Council" }
  ],
  "stream": true,
  "maker_num_voters": 3,
  "maker_k": 3
}
```

### 2. Headers da Resposta

Quando streaming está ativo, o servidor responde com headers específicos de SSE:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *
```

### 3. Formato dos Chunks

Cada chunk é enviado no formato OpenAI:

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"maker-council-v1","choices":[{"index":0,"delta":{"content":"palavra1 palavra2 palavra3"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"maker-council-v1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

## 🧪 Testando com curl

### Teste com Streaming

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "maker-council-v1",
    "messages": [
      { "role": "user", "content": "Qual a melhor abordagem para autenticação JWT?" }
    ],
    "stream": true
  }' --no-buffer
```

### Teste sem Streaming (Resposta Normal)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "maker-council-v1",
    "messages": [
      { "role": "user", "content": "Qual a melhor abordagem para autenticação JWT?" }
    ],
    "stream": false
  }'
```

## 🧪 Testando com o Script de Teste

Para executar os testes automatizados:

1. Certifique-se de que o servidor está rodando:
   ```bash
   npm start
   ```

2. Execute o script de teste:
   ```bash
   node tests/stream-test.js
   ```

O script irá:
- Verificar se o servidor está online
- Testar o modo de streaming
- Testar o modo normal (não-streaming)
- Exibir estatísticas e resultados

## 💡 Implementação Técnica

### Como Funciona

1. **Processamento Interno**: O MAKER-Council ainda processa toda a requisição de forma síncrona (aguarda o consenso completo).
2. **Simulação de Streaming**: Após obter a resposta final, o servidor a envia em pequenos chunks (palavras) para simular streaming.
3. **Delay Controlado**: Um pequeno delay (30ms) é adicionado entre chunks para melhorar a percepção de streaming.

### Funções Auxiliares

- `sendSSEChunk()`: Envia dados no formato SSE
- `chunkByWords()`: Quebra o texto em chunks de palavras (padrão: 3 palavras por chunk)

## 🔧 Considerações

### Performance

- O tempo total de processamento é o mesmo (a latência do MAKER-Council não mudou)
- O streaming apenas melhora a experiência perceptual para o usuário
- Para respostas muito longas, o delay acumulado pode ser significativo

### Melhorias Futuras

1. **Streaming Real**: Implementar streaming verdadeiro onde os microagentes enviam updates durante o processamento
2. **Configuração de Velocidade**: Permitir que o cliente configure o tamanho do chunk e o delay
3. **Streaming de Metadados**: Enviar metadados sobre o progresso da votação

## 🐛 Troubleshooting

### Erro: "Erro de API desconhecido"

- Verifique se o cliente está configurado para aceitar `text/event-stream`
- Alguns clientes precisam do header `Accept: text/event-stream`

### Timeout

- Se o cliente timeout antes do streaming começar, pode ser necessário ajustar os timeouts
- A latência inicial inclui todo o processamento do MAKER-Council

### Formato Incorreto

- Certifique-se de que seu cliente processa corretamente o formato `data: {...}\n\n`
- Lembre-se de tratar o `data: [DONE]\n\n` final

## ✅ Exemplo com Node.js

```javascript
const https = require('https');

const data = JSON.stringify({
  model: 'maker-council-v1',
  messages: [{ role: 'user', content: 'Como funciona o streaming?' }],
  stream: true
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  res.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.substring(6);
        if (data === '[DONE]) return;
        
        const parsed = JSON.parse(data);
        if (parsed.choices[0].delta.content) {
          process.stdout.write(parsed.choices[0].delta.content);
        }
      }
    }
  });
});

req.write(data);
req.end();