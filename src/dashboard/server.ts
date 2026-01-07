import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { logger } from '../db/logger.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT || '3000', 10);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API Endpoints
app.get('/api/requests', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const requests = logger.getRecentRequests(limit, offset);
  res.json(requests);
});

app.get('/api/requests/:id', (req, res) => {
  const details = logger.getRequestDetails(req.params.id);
  if (!details.request) {
    res.status(404).json({ error: 'Request not found' });
    return;
  }
  res.json(details);
});

app.get('/api/stats', (req, res) => {
  const stats = logger.getStats();
  res.json(stats);
});

app.delete('/api/data', async (req, res) => {
  try {
    logger.clearAllData();
    res.json({ success: true, message: 'All data cleared' });
  } catch (error) {
    console.error('Failed to clear data:', error);
    res.status(500).json({ error: 'Failed to clear data' });
  }
});

function loadSettings() {
  try {
    const settingsPath = path.join(process.cwd(), 'data', 'dashboard-settings.json');
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch (e) {
    console.error('Error loading settings:', e);
  }
  return {
    entryLimit: parseInt(process.env.DASHBOARD_ENTRY_LIMIT || '1000'),
    autoRefreshInterval: parseInt(process.env.DASHBOARD_REFRESH_INTERVAL || '5000')
  };
}

app.get('/api/settings', (req, res) => {
  const settings = loadSettings();
  res.json(settings);
});

app.post('/api/settings', async (req, res) => {
  const { entryLimit, autoRefreshInterval } = req.body;
  
  const settings = {
    entryLimit: parseInt(entryLimit) || 1000,
    autoRefreshInterval: parseInt(autoRefreshInterval) || 5000
  };
  
  try {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(dataDir, 'dashboard-settings.json'),
      JSON.stringify(settings, null, 2)
    );
    
    if (settings.entryLimit) {
      logger.pruneOldEntries(settings.entryLimit);
    }
    
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Failed to save settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Fallback to index.html for SPA
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
📊 MAKER-Council Dashboard
   URL: http://localhost:${PORT}
   Database: data/maker_monitoring.db
   Note: The MCP server writes data here when invoked via MCP clients
  `);
});