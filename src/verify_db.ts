import { logger } from './db/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (command === 'clear') {
        console.log('Clearing database...');
        logger.clearAllData();
        console.log('Database cleared.');
    } else if (command === 'checkpoint') {
        console.log('Running WAL checkpoint...');
        const db = (logger as any).db;
        db.pragma('wal_checkpoint(RESTART)');
        console.log('Checkpoint complete.');
    } else if (command === 'count') {
        const stats = logger.getStats();
        console.log(`Total Requests: ${stats.total}`);
    } else if (command === 'list') {
        const requests = logger.getRecentRequests(10) as any[];
        console.log('Recent Requests:');
        requests.forEach(req => {
            console.log(`- [${req.timestamp}] ${req.tool_name} (${req.status}): ${req.prompt?.substring(0, 50)}...`);
        });
    } else if (command === 'check_connection') {
        const dbPath = path.join(__dirname, '..', 'data', 'maker_monitoring.db');
        console.log(`Checking database at: ${dbPath}`);
        if (fs.existsSync(dbPath)) {
             console.log('Database file exists.');
             try {
                // Try to read directly
                const db = (logger as any).db;
                const count = db.prepare('SELECT COUNT(*) as count FROM requests').get();
                console.log(`Direct read count: ${count.count}`);
             } catch(e) {
                 console.error('Direct read failed:', e);
             }
        } else {
             console.log('Database file DOES NOT exist.');
        }
    } else {
        console.log('Usage: tsx src/verify_db.ts [clear|count|list|checkpoint|check_connection]');
    }
}

main().catch(console.error);