/**
 * Servidor Express:
 *   GET  /        → dashboard HTML
 *   GET  /data    → odds.json atual
 *   GET  /health  → status
 *   POST /trigger → dispara coleta manual
 */
import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runCollection } from './main.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE  = join(__dirname, 'data', 'odds.json');
const DASH_FILE  = join(__dirname, 'dashboard', 'server.html');
const PORT       = process.env.SERVER_PORT || 8080;
const INTERVAL_MS = (parseInt(process.env.SCRAPE_INTERVAL_MINUTES) || 60) * 60 * 1000;

const app = express();
let isRunning = false;
let lastFinishedAt = 0;
const COOLDOWN_MS = 3 * 60 * 1000;  // 3 min entre coletas — evita VM saturada

// CORS — libera requests do GitHub Pages (https://victpaiva-byte.github.io)
// e qualquer origin (front estático pode estar em vários hosts).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req, res) => {
  if (!existsSync(DASH_FILE)) return res.status(404).send('dashboard/server.html não encontrado');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(readFileSync(DASH_FILE));
});

app.get('/data', (req, res) => {
  if (!existsSync(DATA_FILE)) {
    return res.json({ updatedAt: null, totalRows: 0, rows: [], rawCount: 0, summary: null });
  }
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(readFileSync(DATA_FILE));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => {
  let updatedAt = null, totalRows = 0;
  if (existsSync(DATA_FILE)) {
    try { ({ updatedAt, totalRows } = JSON.parse(readFileSync(DATA_FILE))); } catch {}
  }
  res.json({ status: 'ok', updatedAt, totalRows, isRunning, serverTime: new Date().toISOString() });
});

app.post('/trigger', async (req, res) => {
  if (isRunning) return res.status(409).json({ status: 'already_running' });
  const sinceLast = Date.now() - lastFinishedAt;
  if (lastFinishedAt && sinceLast < COOLDOWN_MS) {
    const waitS = Math.ceil((COOLDOWN_MS - sinceLast) / 1000);
    return res.status(429).json({ status: 'cooldown', wait_seconds: waitS });
  }
  res.json({ status: 'started' });
  triggerCollection();
});

async function triggerCollection() {
  if (isRunning) return;
  isRunning = true;
  try {
    await runCollection();
  } catch (e) {
    console.error('Coleta falhou:', e.message);
  } finally {
    isRunning = false;
    lastFinishedAt = Date.now();
  }
}

app.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   Dados:     http://localhost:${PORT}/data`);
  console.log(`   Coleta a cada ${INTERVAL_MS / 60000} minutos\n`);

  // Primeira coleta imediata
  triggerCollection();

  // Agendamento periódico
  setInterval(triggerCollection, INTERVAL_MS);
});
