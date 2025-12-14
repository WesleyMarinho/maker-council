# Streaming Guide - MAKER-Council API

## 📋 Overview

The MAKER-Council server now supports streaming (Server-Sent Events - SSE) on the `/v1/chat/completions` endpoint. This allows clients to receive responses in real-time, word by word, improving user experience.

## 🚀 How to Use

### 1. Request with Streaming

To enable streaming, include `"stream": true` in your request:

```json
{
  "model": "maker-council-v1",
  "messages": [
    { "role": "user", "content": "Explain how the MAKER-Council voting algorithm works" }
  ],
  "stream": true,
  "maker_num_voters": 3,
  "maker_k": 3
}
```

### 2. Response Headers

When streaming is active, the server responds with SSE-specific headers:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *
```

### 3. Chunk Format

Each chunk is sent in OpenAI format:

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"maker-council-v1","choices":[{"index":0,"delta":{"content":"word1 word2 word3"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"maker-council-v1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

## 🧪 Testing with curl

### Test with Streaming

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "maker-council-v1",
    "messages": [
      { "role": "user", "content": "What is the best approach for JWT authentication?" }
    ],
    "stream": true
  }' --no-buffer
```

### Test without Streaming (Normal Response)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "maker-council-v1",
    "messages": [
      { "role": "user", "content": "What is the best approach for JWT authentication?" }
    ],
    "stream": false
  }'
```

## 🧪 Testing with the Test Script

To run automated tests:

1. Make sure the server is running:
   ```bash
   npm start
   ```

2. Run the test script:
   ```bash
   node tests/stream-test.js
   ```

The script will:
- Check if the server is online
- Test streaming mode
- Test normal (non-streaming) mode
- Display statistics and results

## 💡 Technical Implementation

### How It Works

1. **Internal Processing**: MAKER-Council still processes the entire request synchronously (waits for complete consensus).
2. **Streaming Simulation**: After obtaining the final response, the server sends it in small chunks (words) to simulate streaming.
3. **Controlled Delay**: A small delay (30ms) is added between chunks to improve the streaming perception.

### Helper Functions

- `sendSSEChunk()`: Sends data in SSE format
- `chunkByWords()`: Breaks text into word chunks (default: 3 words per chunk)

## 🔧 Considerations

### Performance

- Total processing time is the same (MAKER-Council latency hasn't changed)
- Streaming only improves perceptual experience for the user
- For very long responses, accumulated delay can be significant

### Future Improvements

1. **Real Streaming**: Implement true streaming where microagents send updates during processing
2. **Speed Configuration**: Allow client to configure chunk size and delay
3. **Metadata Streaming**: Send metadata about voting progress

## 🐛 Troubleshooting

### Error: "Unknown API error"

- Check if the client is configured to accept `text/event-stream`
- Some clients need the `Accept: text/event-stream` header

### Timeout

- If the client times out before streaming starts, timeouts may need adjustment
- Initial latency includes all MAKER-Council processing

### Incorrect Format

- Make sure your client properly processes the `data: {...}\n\n` format
- Remember to handle the final `data: [DONE]\n\n`

## ✅ Example with Node.js

```javascript
const https = require('https');

const data = JSON.stringify({
  model: 'maker-council-v1',
  messages: [{ role: 'user', content: 'How does streaming work?' }],
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
        if (data === '[DONE]') return;
        
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
```
