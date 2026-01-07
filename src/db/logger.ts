import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface RequestLog {
  id: string;
  timestamp: string;
  tool_name: string;
  prompt: string;
  intent?: string;
  config?: string; // JSON
  status: 'pending' | 'success' | 'error';
  duration_ms: number;
}

export interface ResponseLog {
  request_id: string;
  timestamp: string;
  result: string; // JSON or text
  metadata?: string; // JSON
}

export interface LogEntry {
  request_id?: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  stack_trace?: string;
}

export interface ToolCallLog {
  id: string;
  request_id: string;
  timestamp: string;
  tool_name: string;
  arguments: string; // JSON
  output?: string;
  error?: string;
  duration_ms: number;
}

export class Logger {
  private db: Database.Database;
  private static instance: Logger;

  private constructor() {
    // Resolve data directory relative to the package root (project root)
    // We are in src/db/ (or dist/db/), so we go up two levels
    const projectRoot = path.resolve(__dirname, '..', '..');
    const dbDir = path.join(projectRoot, 'data');
    
    // Debug log to stderr (visible in MCP logs)
    console.error(`[MAKER-DB] Initializing database in: ${dbDir}`);

    if (!fs.existsSync(dbDir)) {
      try {
        fs.mkdirSync(dbDir, { recursive: true });
        console.error(`[MAKER-DB] Created data directory: ${dbDir}`);
      } catch (e) {
        console.error(`[MAKER-DB] Failed to create data directory: ${e}`);
        // Fallback to process.cwd() if absolute path fails permissions
        const fallbackDir = path.resolve(process.cwd(), 'data');
        console.error(`[MAKER-DB] Falling back to CWD: ${fallbackDir}`);
        if (!fs.existsSync(fallbackDir)) {
            fs.mkdirSync(fallbackDir, { recursive: true });
        }
        const dbPath = path.join(fallbackDir, 'maker_monitoring.db');
        this.db = new Database(dbPath);
        this.initSchema();
        return;
      }
    }

    const dbPath = path.join(dbDir, 'maker_monitoring.db');
    console.error(`[MAKER-DB] Database path: ${dbPath}`);
    
    try {
      this.db = new Database(dbPath);
      this.initSchema();
      console.error(`[MAKER-DB] Database initialized successfully`);
    } catch (e) {
      console.error(`[MAKER-DB] Failed to initialize database: ${e}`);
      throw e;
    }
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private initSchema() {
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        prompt TEXT,
        intent TEXT,
        config TEXT,
        status TEXT NOT NULL,
        duration_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS responses (
        request_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        result TEXT,
        metadata TEXT,
        FOREIGN KEY(request_id) REFERENCES requests(id)
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        stack_trace TEXT,
        FOREIGN KEY(request_id) REFERENCES requests(id)
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments TEXT,
        output TEXT,
        error TEXT,
        duration_ms INTEGER,
        FOREIGN KEY(request_id) REFERENCES requests(id)
      );

      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_request_id ON logs(request_id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_request_id ON tool_calls(request_id);
    `);
  }

  public logRequest(req: RequestLog) {
    const stmt = this.db.prepare(`
      INSERT INTO requests (id, timestamp, tool_name, prompt, intent, config, status, duration_ms)
      VALUES (@id, @timestamp, @tool_name, @prompt, @intent, @config, @status, @duration_ms)
    `);
    stmt.run({
        ...req,
        intent: req.intent || null,
        config: req.config || null,
        prompt: req.prompt || null
    });
  }

  public updateRequestStatus(id: string, status: string, duration_ms: number) {
    const stmt = this.db.prepare(`
      UPDATE requests SET status = ?, duration_ms = ? WHERE id = ?
    `);
    stmt.run(status, duration_ms, id);
  }

  public logResponse(res: ResponseLog) {
    const stmt = this.db.prepare(`
      INSERT INTO responses (request_id, timestamp, result, metadata)
      VALUES (@request_id, @timestamp, @result, @metadata)
    `);
    stmt.run({
        ...res,
        result: res.result || null,
        metadata: res.metadata || null
    });
  }

  public log(entry: Omit<LogEntry, 'timestamp'>) {
    const timestamp = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO logs (request_id, timestamp, level, message, stack_trace)
      VALUES (@request_id, @timestamp, @level, @message, @stack_trace)
    `);
    stmt.run({
        ...entry,
        timestamp,
        request_id: entry.request_id || null,
        stack_trace: entry.stack_trace || null
    });
  }

  public logToolCall(entry: ToolCallLog) {
    const stmt = this.db.prepare(`
      INSERT INTO tool_calls (id, request_id, timestamp, tool_name, arguments, output, error, duration_ms)
      VALUES (@id, @request_id, @timestamp, @tool_name, @arguments, @output, @error, @duration_ms)
    `);
    stmt.run({
      ...entry,
      output: entry.output || null,
      error: entry.error || null
    });
  }

  public clearAllData() {
    try {
      // Delete child tables first (those with foreign keys to requests)
      this.db.exec('DELETE FROM responses');
      this.db.exec('DELETE FROM tool_calls');
      this.db.exec('DELETE FROM logs');
      // Then delete the parent table
      this.db.exec('DELETE FROM requests');
      // Reclaim disk space
      this.db.exec('VACUUM');
    } catch (error) {
      console.error('Error clearing data:', error);
      throw error;
    }
  }

  public pruneOldEntries(limit: number) {
    // Keep only the most recent `limit` entries
    const stmt = this.db.prepare(`
        DELETE FROM requests
        WHERE id NOT IN (
            SELECT id FROM requests
            ORDER BY timestamp DESC
            LIMIT ?
        )
    `);
    stmt.run(limit);
    
    // Clean up orphaned responses, tool_calls, logs
    this.db.exec('DELETE FROM responses WHERE request_id NOT IN (SELECT id FROM requests)');
    this.db.exec('DELETE FROM tool_calls WHERE request_id NOT IN (SELECT id FROM requests)');
    this.db.exec('DELETE FROM logs WHERE request_id NOT IN (SELECT id FROM requests)');
  }

  // Query methods for dashboard
  public getRecentRequests(limit: number = 50, offset: number = 0) {
    const stmt = this.db.prepare(`
      SELECT * FROM requests ORDER BY timestamp DESC LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset);
  }

  public getRequestDetails(id: string) {
    const request = this.db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
    const response = this.db.prepare('SELECT * FROM responses WHERE request_id = ?').get(id);
    const logs = this.db.prepare('SELECT * FROM logs WHERE request_id = ? ORDER BY timestamp ASC').all(id);
    const tool_calls = this.db.prepare('SELECT * FROM tool_calls WHERE request_id = ? ORDER BY timestamp ASC').all(id);
    return { request, response, logs, tool_calls };
  }

  public getStats() {
    const totalRequests = this.db.prepare('SELECT COUNT(*) as count FROM requests').get() as { count: number };
    const errorCount = this.db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'error'").get() as { count: number };
    const avgDuration = this.db.prepare("SELECT AVG(duration_ms) as avg FROM requests WHERE status = 'success'").get() as { avg: number };
    
    // Requests by tool
    const toolStats = this.db.prepare(`
      SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_duration 
      FROM requests 
      GROUP BY tool_name
    `).all();

    return {
      total: totalRequests.count,
      errors: errorCount.count,
      avgDuration: avgDuration.avg || 0,
      toolStats
    };
  }
}

export const logger = Logger.getInstance();