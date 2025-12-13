/**
 * Teste para verificar o suporte a streaming do MAKER-Council API
 */

const http = require('http');

// Configurações
const PORT = process.env.PORT || 3000;
const API_URL = `http://localhost:${PORT}`;

// Função para testar streaming
function testStreaming() {
  console.log('🧪 Testando streaming...\n');
  
  const postData = JSON.stringify({
    model: 'maker-council-v1',
    messages: [
      { role: 'user', content: 'Qual é a melhor abordagem para autenticação em APIs?' }
    ],
    stream: true,
    maker_num_voters: 3,
    maker_k: 3
  });

  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    console.log('Headers:', res.headers);
    console.log('\n📦 Resposta streaming:\n');
    
    let buffer = '';
    
    res.on('data', (chunk) => {
      buffer += chunk;
      const lines = chunk.toString().split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6);
          if (data === '[DONE]') {
            console.log('✅ Streaming concluído!');
            console.log('\n📊 Estatísticas:');
            console.log('- Chunks recebidos:', buffer.split('\n').filter(l => l.startsWith('data: ')).length - 1);
            testNonStreaming();
          } else {
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                process.stdout.write(parsed.choices[0].delta.content);
              }
            } catch (e) {
              console.error('\n❌ Erro ao parsear chunk:', data);
            }
          }
        }
      }
    });
    
    res.on('end', () => {
      console.log('\n\n✅ Conexão encerrada');
    });
  });

  req.on('error', (e) => {
    console.error(`❌ Erro na requisição: ${e.message}`);
    if (e.code === 'ECONNREFUSED') {
      console.log('\n💡 Dica: Certifique-se de que o servidor está rodando em:', API_URL);
    }
  });

  req.write(postData);
  req.end();
}

// Função para testar resposta normal (não-streaming)
function testNonStreaming() {
  console.log('\n\n🧪 Testando resposta normal (não-streaming)...\n');
  
  const postData = JSON.stringify({
    model: 'maker-council-v1',
    messages: [
      { role: 'user', content: 'Qual é a melhor abordagem para autenticação em APIs?' }
    ],
    stream: false,
    maker_num_voters: 2,
    maker_k: 2
  });

  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        console.log('\n✅ Resposta recebida com sucesso!');
        console.log('\n📋 Conteúdo da resposta:');
        console.log(parsed.choices[0].message.content);
        console.log('\n🎉 Todos os testes concluídos com sucesso!');
      } catch (e) {
        console.error('\n❌ Erro ao parsear resposta:', e.message);
        console.log('Resposta bruta:', data);
      }
    });
  });

  req.on('error', (e) => {
    console.error(`❌ Erro na requisição: ${e.message}`);
  });

  req.write(postData);
  req.end();
}

// Verificar se o servidor está rodando antes de testar
function checkServer() {
  console.log(`🔍 Verificando se o servidor está rodando em ${API_URL}...`);
  
  const req = http.get(`${API_URL}/health`, (res) => {
    if (res.statusCode === 200) {
      console.log('✅ Servidor está online! Iniciando testes...\n');
      testStreaming();
    } else {
      console.log(`❌ Servidor respondeu com status: ${res.statusCode}`);
    }
  });
  
  req.on('error', (e) => {
    if (e.code === 'ECONNREFUSED') {
      console.log('❌ Servidor não está rodando!');
      console.log('\n💡 Para iniciar o servidor, execute:');
      console.log('   npm start');
      console.log('   ou');
      console.log('   node dist/index.js');
    } else {
      console.error(`❌ Erro ao verificar servidor: ${e.message}`);
    }
  });
}

// Executar verificação
checkServer();