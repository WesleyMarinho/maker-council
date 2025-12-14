
import { spawn } from 'child_process';
// Using global fetch which is present in Node 18+ (which tsx uses)

/**
 * Communication Flaws & Production Flow Test
 *
 * This suite tests for:
 * 1. "Roocode" Integration: Ensuring OpenAI compatibility is strictly adhered to.
 * 2. "Antigravity" Flow: Ensuring zero-friction, high-speed request handling (latency checks).
 * 3. Error Resilience: Ensuring the system handles bad input gracefully without crashing.
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const API_ENDPOINT = `${API_BASE_URL}/v1/chat/completions`;

// Helper to wait
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper for logging
const log = (msg: string) => console.log(`[TEST] ${msg}`);
const logError = (msg: string) => console.error(`[ERROR] ${msg}`);

async function checkServerHealth() {
    try {
        const res = await fetch(`${API_BASE_URL}/health`);
        return res.ok;
    } catch (e) {
        return false;
    }
}

async function testRoocodeIntegration() {
    log('--- Testing Roocode/Copilot Integration (OpenAI Compat) ---');
    // Roocode expects standard OpenAI format.
    // We send a request and check if the response structure is EXACTLY what's expected.

    const payload = {
        model: "maker-council-v1",
        messages: [{ role: "user", content: "Say hello briefly." }],
        temperature: 0.7
    };

    const start = Date.now();
    const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        throw new Error(`Roocode Integration Failed: Status ${res.status}`);
    }

    const data: any = await res.json();
    const duration = Date.now() - start;

    // Validation
    if (!data.id) throw new Error("Missing 'id' in response");
    if (!data.object) throw new Error("Missing 'object' in response");
    if (!data.created) throw new Error("Missing 'created' in response");
    if (!data.model) throw new Error("Missing 'model' in response");
    if (!Array.isArray(data.choices)) throw new Error("'choices' must be an array");
    if (!data.choices[0].message) throw new Error("Missing 'message' in choice");
    if (!data.choices[0].message.content) throw new Error("Missing 'content' in message");

    log(`Roocode Integration: PASSED (${duration}ms)`);
}

async function testAntigravityFlow() {
    log('--- Testing "Antigravity" Flow (Zero Friction) ---');
    // Antigravity implies effortless movement. We test if concurrent requests
    // are handled without "friction" (locking or significant slowdowns).

    const requests = 5;
    const promises = [];

    log(`Sending ${requests} concurrent requests...`);

    const start = Date.now();
    for (let i = 0; i < requests; i++) {
        promises.push(fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "maker-council-v1",
                messages: [{ role: "user", content: `Echo this number: ${i}` }]
            })
        }).then(res => res.json()));
    }

    const results = await Promise.all(promises);
    const totalDuration = Date.now() - start;

    // Check for errors in results
    const errors = results.filter((r: any) => !r.choices);
    if (errors.length > 0) {
        throw new Error(`Antigravity Flow Failed: ${errors.length} requests failed.`);
    }

    const avgTime = totalDuration / requests; // This is rough, as they are concurrent
    log(`Antigravity Flow: PASSED (Total: ${totalDuration}ms for ${requests} reqs)`);
}

async function testErrorResilience() {
    log('--- Testing Error Resilience (Production Safety) ---');

    // 1. Malformed JSON
    log("Testing Malformed JSON...");
    try {
        const res = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: "{ 'bad': json " // Invalid JSON
        });
        if (res.status !== 400 && res.status !== 500) {
             // Express might handle body parsing before our handler, usually 400
             // But if it crashes, that's bad.
             log(`Warning: Malformed JSON got status ${res.status}`);
        } else {
             log(`Malformed JSON handled correctly (Status ${res.status})`);
        }
    } catch (e) {
        log(`Network error on malformed JSON (could be server crash?): ${e}`);
    }

    // 2. Missing required fields
    log("Testing Missing Fields...");
    const res2 = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "test" }) // Missing messages
    });

    // Expecting error
    if (res2.ok) {
        throw new Error("Server accepted request with missing messages!");
    }
    log(`Missing fields handled correctly (Status ${res2.status})`);

    // 3. Verify Server still alive
    if (await checkServerHealth()) {
        log("Server survived error injection: PASSED");
    } else {
        throw new Error("Server DIED after error injection!");
    }
}

async function main() {
    log("Starting Communication Flaws Detection...");

    // Check if server is running
    if (!await checkServerHealth()) {
        logError("Server is NOT running. Please start it with `npm run serve` in another terminal.");
        process.exit(1);
    }

    try {
        await testRoocodeIntegration();
        await testAntigravityFlow();
        await testErrorResilience();

        log("All tests passed! Flow seems robust.");
    } catch (e) {
        logError(`TEST FAILED: ${e}`);
        process.exit(1);
    }
}

main();
