// ══════════════════════════════════════════════════════════
//   C8 DASHBOARD v2 — Push-Based SSE Realtime
//   Bot POST data → Server → Browser instant update
// ══════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Config ───
const API_KEY = process.env.API_KEY || 'c8dashboard2025';
const PORT = process.env.PORT || 3456;

// ─── In-Memory Store ───
const store = new Map();
let firstReceivedAt = null; // Track uptime from first data received
let pnlBaseline = null; // Server-side P&L baseline (shared across devices)
let earnBaseline = null; // Daily earn baseline (auto-reset at 10 AM)
const DATA_FILE = path.join(__dirname, 'data.json');

// Load persisted data on startup
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (saved.store) {
        for (const [key, val] of Object.entries(saved.store)) {
          store.set(key, val);
        }
      }
      if (saved.pnlBaseline) pnlBaseline = saved.pnlBaseline;
      if (saved.earnBaseline) earnBaseline = saved.earnBaseline;
      if (saved.firstReceivedAt) firstReceivedAt = saved.firstReceivedAt;
      console.log(`[BOOT] Loaded ${store.size} VPS from cache`);
    }
  } catch (err) {
    console.log(`[BOOT] No cache: ${err.message}`);
  }
}

// Save data to file
function saveData() {
  try {
    const obj = {};
    for (const [key, val] of store) obj[key] = val;
    fs.writeFileSync(DATA_FILE, JSON.stringify({ store: obj, pnlBaseline, earnBaseline, firstReceivedAt }));
  } catch {}
}

loadData();

// ─── Root route: inject live data into HTML ───
app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const all = {};
  for (const [key, val] of store) all[key] = val;
  const inject = `<script>window.__INITIAL_DATA__=${JSON.stringify(all)};</script>`;
  html = html.replace('</head>', inject + '\n</head>');
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(html);
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── SSE Clients ───
const sseClients = new Set();
function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// Heartbeat: keep SSE connections alive every 15s
setInterval(() => {
  for (const client of sseClients) {
    try { client.write(': heartbeat\n\n'); } catch { sseClients.delete(client); }
  }
}, 15000);

// ─── Auto-reset earn baseline at 10 AM daily ───
function resetEarnBaseline() {
  let totalDrew = 0;
  for (const [key, val] of store) {
    for (const w of (val.wallets || [])) {
      if (w.error) continue;
      totalDrew += (w.rewards || {}).drew || 0;
    }
  }
  earnBaseline = { totalDrew, timestamp: Date.now() };
  saveData();
  broadcastSSE('earn-reset', { earnBaseline });
  console.log(`[EARN] Baseline reset at 10 AM: ${totalDrew.toFixed(2)} CC`);
}

function scheduleDailyReset() {
  const now = new Date();
  const target = new Date();
  target.setHours(10, 0, 0, 0); // 10:00 AM
  
  // If it's already past 10 AM today, schedule for tomorrow
  if (now >= target) {
    target.setDate(target.getDate() + 1);
  }
  
  const delay = target - now;
  console.log(`[EARN] Auto-reset scheduled at ${target.toLocaleString()} (in ${Math.round(delay/1000/60)} minutes)`);
  
  setTimeout(() => {
    resetEarnBaseline();
    // Schedule next reset in 24 hours
    setInterval(resetEarnBaseline, 24 * 60 * 60 * 1000);
  }, delay);
}
scheduleDailyReset();

// ══════════════════════════════════════════════
//   API ENDPOINTS
// ══════════════════════════════════════════════

// ─── POST /api/push — Bot pushes data ───
app.post('/api/push', (req, res) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const { vps_id, timestamp, wallets, summary, price, ethPrice, usdToIdr, startedAt, botUptime } = req.body;
  if (!vps_id) {
    return res.status(400).json({ error: 'vps_id required' });
  }

  // Store data
  if (!firstReceivedAt) firstReceivedAt = new Date().toISOString();
  store.set(vps_id, {
    vps_id,
    timestamp: timestamp || new Date().toISOString(),
    wallets: wallets || [],
    summary: summary || {},
    price: price || null,
    ethPrice: ethPrice || null,
    usdToIdr: usdToIdr || null,
    receivedAt: new Date().toISOString(),
    uptimeSince: startedAt || firstReceivedAt,
    botUptime: botUptime || ''
  });

  // Broadcast to all SSE clients
  broadcastSSE('update', {
    type: 'push',
    vps_id,
    data: store.get(vps_id)
  });

  saveData();
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
  let latest = null;
  for (const [key, val] of store) latest = val;
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    vps_count: store.size,
    sse_clients: sseClients.size,
    latest: latest,
    pnlBaseline: pnlBaseline,
    earnBaseline: earnBaseline
  });
});

// ─── POST /api/reset-pnl — Reset P&L baseline ───
app.post('/api/reset-pnl', (req, res) => {
  let latest = null;
  for (const [key, val] of store) latest = val;
  if (!latest) return res.status(400).json({ error: 'No data yet' });

  const wallets = latest.wallets || [];
  const price = latest.price?.price || 0.16;
  const ethPrice = latest.ethPrice || 2500;
  const usdToIdr = latest.usdToIdr || 17000;

  let portfolioUsd = 0, unclaimed = 0, totalCC = 0;
  for (const w of wallets) {
    if (w.error) continue;
    const b = w.balance || {};
    const r = w.rewards || {};
    totalCC += (b.CC || 0);
    portfolioUsd += (b.CC || 0) * price + (b.rCC || 0) * price + (b.USDCx || 0) + (b.cETH || 0) * ethPrice;
    unclaimed += r.unclaimed || 0;
  }

  pnlBaseline = { portfolioUsd, unclaimed, totalCC, timestamp: Date.now() };
  saveData();
  console.log(`[P&L] Baseline reset: $${portfolioUsd.toFixed(2)}, ${unclaimed.toFixed(2)} CC, wallet CC: ${totalCC.toFixed(2)}`);
  res.json({ success: true, pnlBaseline });
});

// ─── POST /api/reset-earn — Reset earn baseline (manual) ───
app.post('/api/reset-earn', (req, res) => {
  resetEarnBaseline();
  res.json({ success: true, earnBaseline });
});

// ─── Command Center ───
app.get('/command', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'command.html'));
});

// ─── SPA Fallback ───
app.get('*', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const all = {};
  for (const [key, val] of store) all[key] = val;
  const inject = `<script>window.__INITIAL_DATA__=${JSON.stringify(all)};</script>`;
  html = html.replace('</head>', inject + '\n</head>');
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(html);
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
