/**
 * MI Learning Agents — Proxy Server
 * Forwards requests from the frontend to the Anthropic API
 * keeping your API key safe on the server side.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node server.js
 *
 * Then open http://localhost:3000 in your browser.
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ── Serve the frontend ────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Anthropic proxy endpoint ──────────────────────────────
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY environment variable is not set.\nRun: ANTHROPIC_API_KEY=sk-ant-... node server.js'
    });
  }

  const body = JSON.stringify({
    model:      req.body.model      || 'claude-sonnet-4-20250514',
    max_tokens: req.body.max_tokens || 1000,
    system:     req.body.system,
    messages:   req.body.messages,
  });

  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length':    Buffer.byteLength(body),
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      res.status(proxyRes.statusCode).set('Content-Type', 'application/json').send(data);
    });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: 'Failed to reach Anthropic API: ' + err.message });
  });

  proxyReq.write(body);
  proxyReq.end();
});

// ── Health check ──────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    apiKeySet: !!process.env.ANTHROPIC_API_KEY,
    port: PORT,
  });
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║   MI Learning Agents — Proxy Server        ║
╠════════════════════════════════════════════╣
║  URL:   http://localhost:${PORT}              ║
║  API:   ${process.env.ANTHROPIC_API_KEY ? '✓ Key loaded' : '✗ No key — set ANTHROPIC_API_KEY'}       ║
╚════════════════════════════════════════════╝
  `);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠  Set your key:  ANTHROPIC_API_KEY=sk-ant-... node server.js\n');
  }
});
