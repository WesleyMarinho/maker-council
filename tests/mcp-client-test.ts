/**
 * MCP Client Integration Test
 * 
 * This script tests the MCP client implementation by:
 * 1. Connecting to the mock MCP server
 * 2. Discovering available tools
 * 3. Executing tools and verifying results
 * 4. Testing the ToolSchemaTranslator
 */

import { McpToolManager, ToolSchemaTranslator, type McpServerConfig, type McpToolWithServer } from '../src/mcp-client/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const MOCK_SERVER_CONFIG: McpServerConfig = {
  name: 'mock-server',
  command: 'node',
  args: [path.join(__dirname, 'mock-mcp-server.cjs')],
  timeout: 10000,
  autoReconnect: false,
};

// Test results tracking
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  const startTime = Date.now();
  console.error(`\n📋 Running test: ${name}`);
  
  try {
    await testFn();
    const duration = Date.now() - startTime;
    results.push({ name, passed: true, duration });
    console.error(`   ✅ PASSED (${duration}ms)`);
  } catch (err) {
    const duration = Date.now() - startTime;
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error, duration });
    console.error(`   ❌ FAILED: ${error} (${duration}ms)`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertIncludes(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${message}: "${haystack}" does not include "${needle}"`);
  }
}

// ============================================================================
// TESTS
// ============================================================================

async function testMcpToolManagerInitialization(): Promise<void> {
  const manager = new McpToolManager([MOCK_SERVER_CONFIG]);
  
  assert(!manager.hasConnections(), 'Should have no connections before initialization');
  assertEqual(manager.getConnectedCount(), 0, 'Connected count should be 0');
  assertEqual(manager.getToolCount(), 0, 'Tool count should be 0');
  
  await manager.initialize();
  
  assert(manager.hasConnections(), 'Should have connections after initialization');
  assertEqual(manager.getConnectedCount(), 1, 'Connected count should be 1');
  assert(manager.getToolCount() > 0, 'Should have discovered tools');
  
  await manager.shutdown();
  
  assert(!manager.hasConnections(), 'Should have no connections after shutdown');
}

async function testToolDiscovery(): Promise<void> {
  const manager = new McpToolManager([MOCK_SERVER_CONFIG]);
  await manager.initialize();
  
  try {
    const tools = manager.getAllTools();
    
    assert(tools.length >= 3, `Should have at least 3 tools, got ${tools.length}`);
    
    // Check for expected tools
    const toolNames = tools.map(t => t.name);
    assert(toolNames.includes('echo'), 'Should have echo tool');
    assert(toolNames.includes('add'), 'Should have add tool');
    assert(toolNames.includes('greet'), 'Should have greet tool');
    
    // Check tool structure
    const echoTool = tools.find(t => t.name === 'echo');
    assert(echoTool !== undefined, 'Echo tool should exist');
    assertEqual(echoTool!.serverName, 'mock-server', 'Server name should match');
    assertEqual(echoTool!.qualifiedName, 'mock-server.echo', 'Qualified name should be correct');
    assert(echoTool!.inputSchema !== undefined, 'Should have input schema');
    assert(echoTool!.inputSchema.properties !== undefined, 'Schema should have properties');
    
  } finally {
    await manager.shutdown();
  }
}

async function testToolExecution(): Promise<void> {
  const manager = new McpToolManager([MOCK_SERVER_CONFIG]);
  await manager.initialize();
  
  try {
    // Test echo tool
    const echoResult = await manager.executeTool({
      toolName: 'echo',
      arguments: { message: 'Hello, World!' },
    });
    
    assert(echoResult.success, `Echo should succeed: ${echoResult.error}`);
    assertIncludes(String(echoResult.content), 'Hello, World!', 'Echo should return the message');
    assertEqual(echoResult.serverName, 'mock-server', 'Server name should match');
    assertEqual(echoResult.toolName, 'echo', 'Tool name should match');
    
    // Test add tool
    const addResult = await manager.executeTool({
      toolName: 'add',
      arguments: { a: 5, b: 3 },
    });
    
    assert(addResult.success, `Add should succeed: ${addResult.error}`);
    assertIncludes(String(addResult.content), '8', 'Add should return correct sum');
    
    // Test greet tool
    const greetResult = await manager.executeTool({
      toolName: 'greet',
      arguments: { name: 'Alice', formal: true },
    });
    
    assert(greetResult.success, `Greet should succeed: ${greetResult.error}`);
    assertIncludes(String(greetResult.content), 'Alice', 'Greet should include the name');
    assertIncludes(String(greetResult.content), 'Good day', 'Formal greet should use formal language');
    
  } finally {
    await manager.shutdown();
  }
}

async function testQualifiedToolExecution(): Promise<void> {
  const manager = new McpToolManager([MOCK_SERVER_CONFIG]);
  await manager.initialize();
  
  try {
    // Test with qualified name
    const result = await manager.executeQualifiedTool(
      'mock-server.echo',
      { message: 'Qualified call test' }
    );
    
    assert(result.success, `Qualified call should succeed: ${result.error}`);
    assertIncludes(String(result.content), 'Qualified call test', 'Should echo the message');
    
  } finally {
    await manager.shutdown();
  }
}

async function testToolNotFound(): Promise<void> {
  const manager = new McpToolManager([MOCK_SERVER_CONFIG]);
  await manager.initialize();
  
  try {
    const result = await manager.executeTool({
      toolName: 'nonexistent-tool',
      arguments: {},
    });
    
    assert(!result.success, 'Should fail for nonexistent tool');
    assertIncludes(result.error || '', 'not found', 'Error should mention tool not found');
    
  } finally {
    await manager.shutdown();
  }
}

async function testToolSchemaTranslator(): Promise<void> {
  // Create a sample tool
  const sampleTool: McpToolWithServer = {
    name: 'test-tool',
    description: 'A test tool for schema translation',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input parameter' },
        count: { type: 'integer', description: 'Count parameter' },
      },
      required: ['input'],
    },
    serverName: 'test-server',
    qualifiedName: 'test-server.test-tool',
  };
  
  // Test OpenAI format conversion
  const openaiTool = ToolSchemaTranslator.toOpenAITool(sampleTool);
  
  assertEqual(openaiTool.type, 'function', 'OpenAI tool type should be function');
  assertEqual(openaiTool.function.name, 'test-server__test-tool', 'OpenAI name should be sanitized');
  assertEqual(openaiTool.function.description, 'A test tool for schema translation', 'Description should match');
  assert(openaiTool.function.parameters !== undefined, 'Should have parameters');
  
  // Test Anthropic format conversion
  const anthropicTool = ToolSchemaTranslator.toAnthropicTool(sampleTool);
  
  assertEqual(anthropicTool.name, 'test-server__test-tool', 'Anthropic name should be sanitized');
  assertEqual(anthropicTool.description, 'A test tool for schema translation', 'Description should match');
  assert(anthropicTool.input_schema !== undefined, 'Should have input_schema');
  
  // Test name sanitization
  const sanitized = ToolSchemaTranslator.sanitizeToolName('server.tool-name');
  assertEqual(sanitized, 'server__tool-name', 'Should sanitize dots to double underscores');
  
  // Test name unsanitization
  const unsanitized = ToolSchemaTranslator.unsanitizeToolName('server__tool-name');
  assertEqual(unsanitized, 'server.tool-name', 'Should unsanitize double underscores to dots');
  
  // Test qualified name parsing
  const parsed = ToolSchemaTranslator.parseQualifiedName('server.tool.name');
  assertEqual(parsed.serverName, 'server', 'Should parse server name');
  assertEqual(parsed.toolName, 'tool.name', 'Should parse tool name');
  
  // Test argument validation
  const validArgs = { input: 'test' };
  const validResult = ToolSchemaTranslator.validateArguments(validArgs, sampleTool.inputSchema);
  assert(validResult.valid, 'Valid args should pass validation');
  assertEqual(validResult.errors.length, 0, 'Should have no errors');
  
  const invalidArgs = {};
  const invalidResult = ToolSchemaTranslator.validateArguments(invalidArgs, sampleTool.inputSchema);
  assert(!invalidResult.valid, 'Invalid args should fail validation');
  assert(invalidResult.errors.length > 0, 'Should have errors');
  assertIncludes(invalidResult.errors[0], 'input', 'Error should mention missing field');
}

async function testMultipleToolsConversion(): Promise<void> {
  const tools: McpToolWithServer[] = [
    {
      name: 'tool1',
      description: 'First tool',
      inputSchema: { type: 'object', properties: {} },
      serverName: 'server1',
      qualifiedName: 'server1.tool1',
    },
    {
      name: 'tool2',
      description: 'Second tool',
      inputSchema: { type: 'object', properties: {} },
      serverName: 'server2',
      qualifiedName: 'server2.tool2',
    },
  ];
  
  const openaiTools = ToolSchemaTranslator.toOpenAITools(tools);
  assertEqual(openaiTools.length, 2, 'Should convert all tools');
  assertEqual(openaiTools[0].function.name, 'server1__tool1', 'First tool name should be correct');
  assertEqual(openaiTools[1].function.name, 'server2__tool2', 'Second tool name should be correct');
  
  const anthropicTools = ToolSchemaTranslator.toAnthropicTools(tools);
  assertEqual(anthropicTools.length, 2, 'Should convert all tools');
}

async function testConnectionInfo(): Promise<void> {
  const manager = new McpToolManager([MOCK_SERVER_CONFIG]);
  await manager.initialize();
  
  try {
    const infos = manager.getConnectionsInfo();
    assertEqual(infos.length, 1, 'Should have one connection info');
    
    const info = infos[0];
    assertEqual(info.serverName, 'mock-server', 'Server name should match');
    assertEqual(info.state, 'connected', 'State should be connected');
    assert(info.tools.length >= 3, 'Should have tools in connection info');
    assert(info.connectedAt !== undefined, 'Should have connected timestamp');
    
    // Test specific server info
    const specificInfo = manager.getConnectionInfo('mock-server');
    assert(specificInfo !== undefined, 'Should find specific server info');
    assertEqual(specificInfo!.serverName, 'mock-server', 'Server name should match');
    
    // Test non-existent server
    const nonExistent = manager.getConnectionInfo('non-existent');
    assert(nonExistent === undefined, 'Should return undefined for non-existent server');
    
  } finally {
    await manager.shutdown();
  }
}

async function testEventHandling(): Promise<void> {
  const manager = new McpToolManager([MOCK_SERVER_CONFIG]);
  
  const events: string[] = [];
  
  manager.addEventListener((event) => {
    events.push(event.type);
  });
  
  await manager.initialize();
  
  // Should have received connected and toolsUpdated events
  assert(events.includes('connected'), 'Should receive connected event');
  assert(events.includes('toolsUpdated'), 'Should receive toolsUpdated event');
  
  // Execute a tool to trigger toolExecuted event
  await manager.executeTool({
    toolName: 'echo',
    arguments: { message: 'test' },
  });
  
  assert(events.includes('toolExecuted'), 'Should receive toolExecuted event');
  
  await manager.shutdown();
  
  assert(events.includes('disconnected'), 'Should receive disconnected event');
}

async function testFindTool(): Promise<void> {
  const manager = new McpToolManager([MOCK_SERVER_CONFIG]);
  await manager.initialize();
  
  try {
    // Find by simple name
    let tool = manager.findTool('echo');
    assert(tool !== undefined, 'Should find tool by simple name');
    assertEqual(tool!.name, 'echo', 'Tool name should match');
    
    // Find by qualified name
    tool = manager.findTool('mock-server.echo');
    assert(tool !== undefined, 'Should find tool by qualified name');
    assertEqual(tool!.qualifiedName, 'mock-server.echo', 'Qualified name should match');
    
    // Find by sanitized name
    tool = manager.findTool('mock-server__echo');
    assert(tool !== undefined, 'Should find tool by sanitized name');
    assertEqual(tool!.name, 'echo', 'Tool name should match');
    
    // Non-existent tool
    tool = manager.findTool('nonexistent');
    assert(tool === undefined, 'Should return undefined for non-existent tool');
    
  } finally {
    await manager.shutdown();
  }
}

async function testToolsSummary(): Promise<void> {
  const manager = new McpToolManager([MOCK_SERVER_CONFIG]);
  await manager.initialize();
  
  try {
    const summary = manager.getToolsSummary();
    
    assertIncludes(summary, 'Available tools', 'Summary should have header');
    assertIncludes(summary, 'mock-server', 'Summary should include server name');
    assertIncludes(summary, 'echo', 'Summary should include echo tool');
    assertIncludes(summary, 'add', 'Summary should include add tool');
    
  } finally {
    await manager.shutdown();
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.error('\n🧪 MCP Client Integration Tests\n');
  console.error('='.repeat(50));
  
  // Run all tests
  await runTest('McpToolManager Initialization', testMcpToolManagerInitialization);
  await runTest('Tool Discovery', testToolDiscovery);
  await runTest('Tool Execution', testToolExecution);
  await runTest('Qualified Tool Execution', testQualifiedToolExecution);
  await runTest('Tool Not Found', testToolNotFound);
  await runTest('ToolSchemaTranslator', testToolSchemaTranslator);
  await runTest('Multiple Tools Conversion', testMultipleToolsConversion);
  await runTest('Connection Info', testConnectionInfo);
  await runTest('Event Handling', testEventHandling);
  await runTest('Find Tool', testFindTool);
  await runTest('Tools Summary', testToolsSummary);
  
  // Print summary
  console.error('\n' + '='.repeat(50));
  console.error('\n📊 Test Results Summary\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  
  console.error(`   Total:  ${results.length}`);
  console.error(`   Passed: ${passed} ✅`);
  console.error(`   Failed: ${failed} ❌`);
  console.error(`   Duration: ${totalDuration}ms`);
  
  if (failed > 0) {
    console.error('\n❌ Failed Tests:');
    for (const result of results.filter(r => !r.passed)) {
      console.error(`   - ${result.name}: ${result.error}`);
    }
    process.exit(1);
  } else {
    console.error('\n✅ All tests passed!');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});