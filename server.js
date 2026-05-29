// ══════════════════════════════════════════════════════════
//   C8 DASHBOARD v2 — Push-Based SSE Realtime
//   Bot POST data → Server → Browser instant update
// ══════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Config ───
const API_KEY = process.env.API_KEY || 'c8dashboard2025';
const PORT = process.env.PORT || 3456;

// ─── In-Memory Store ───
// Key: vps_id, Value: { timestamp, wallets[], summary }
const store = new Map();

// ─── SSE Clients ───
const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// ══════════════════════════════════════════════
//   API ENDPOINTS
// ══════════════════════════════════════════════

// ─── POST /api/push — Bot pushes data ───
app.post('/api/push', (req, res) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const { vps_id, timestamp, wallets, summary, price, ethPrice, usdToIdr } = req.body;
  if (!vps_id) {
    return res.status(400).json({ error: 'vps_id required' });
  }

  // Store data
  store.set(vps_id, {
    vps_id,
    timestamp: timestamp || new Date().toISOString(),
    wallets: wallets || [],
    summary: summary || {},
    price: price || null,
    ethPrice: ethPrice || null,
    usdToIdr: usdToIdr || null,
    receivedAt: new Date().toISOString()
  });

  // Broadcast to all SSE clients
  broadcastSSE('update', {
    type: 'push',
    vps_id,
    data: store.get(vps_id)
  });

  console.log(`[PUSH] ${vps_id} — ${(wallets || []).length} wallets at ${new Date().toLocaleTimeString()}`);
  res.json({ success: true, vps_id });
});

// ─── GET /api/data — Get all stored data ───
app.get('/api/data', (req, res) => {
  const all = {};
  for (const [key, val] of store) {
    all[key] = val;
  }
  res.json({
    vps_count: store.size,
    total_wallets: Object.values(all).reduce((s, v) => s + (v.wallets || []).length, 0),
    data: all
  });
});

// ─── GET /api/stream — SSE endpoint ───
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send current state immediately
  const all = {};
  for (const [key, val] of store) all[key] = val;
  res.write(`event: init\ndata: ${JSON.stringify({ vps_count: store.size, data: all })}\n\n`);

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ─── GET /api/health ───
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    vps_count: store.size,
    sse_clients: sseClients.size
  });
});

// ─── Command Center ───
app.get('/command', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'command.html'));
});

// ─── SPA Fallback ───
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ───

// ─── GitHub Webhook: Auto-deploy on push ───
app.post('/api/webhook', (req, res) => {
  const event = req.headers['x-github-event'];
  if (event === 'push') {
    console.log('[DEPLOY] GitHub push received, deploying...');
    const { execSync } = require('child_process');
    try {
      execSync('cd /home/ubuntu/c8-dashboard && git pull origin main --force', { timeout: 30000 });
      execSync('cd /home/ubuntu/c8-dashboard && npm install --production', { timeout: 60000 });
      execSync('pm2 restart c8-dashboard c8-fetcher', { timeout: 10000 });
      console.log('[DEPLOY] Success!');
    } catch (err) {
      console.error('[DEPLOY] Failed:', err.message);
    }
  }
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ██████╗ █████╗ ███╗   ██╗████████╗ ██████╗ ██████╗  █████╗');
  console.log(' ██╔════╝██╔══██╗████╗  ██║╚══██╔══╝██╔═══██╗╚════██╗██╔══██╗');
  console.log(' ██║     ███████║██╔██╗ ██║   ██║   ██║   ██║ █████╔╝╚█████╔╝');
  console.log(' ██║     ██╔══██║██║╚██╗██║   ██║   ██║   ██║██╔═══╝ ██╔══██╗');
  console.log(' ╚██████╗██║  ██║██║ ╚████║   ██║   ╚██████╔╝███████╗╚█████╔╝');
  console.log('  ╚═════╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚══════╝ ╚════╝');
  console.log('');
  console.log(`  Dashboard: http://localhost:${PORT}`);
  console.log(`  Command:   http://localhost:${PORT}/command`);
  console.log(`  API Key:   ${API_KEY.slice(0, 4)}****`);
  console.log('');
});
