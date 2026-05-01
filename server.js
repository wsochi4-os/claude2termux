require('dotenv').config();
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const crypto = require('crypto');
const cors = require('cors');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin-token';
const AGENT_SECRET = process.env.AGENT_SECRET || 'change-me-agent-secret';
const PORT = process.env.PORT || 8080;

const app = express();
app.use(cors());
app.use(express.json({limit: '2mb'}));

// Serve web UI under /ui
app.use('/ui', express.static('public'));

// ws clients: clientId => ws
const wsClients = new Map();
// queued commands for polling clients: clientId => [{id,cmd}]
const pending = new Map();
// collected outputs: execId => [{type, stdout?, stderr?, code?}]
const results = new Map();

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req, clientInfo) => {
  const clientId = clientInfo.clientId;
  console.log('Agent connected (ws):', clientId);
  wsClients.set(clientId, ws);

  ws.on('message', data => {
    try {
      const m = JSON.parse(data.toString());
      console.log('From', clientId, m.type || 'msg');
      if (m.id) {
        if (!results.has(m.id)) results.set(m.id, []);
        results.get(m.id).push(m);
      }
    } catch (e) { console.error('ws msg parse error', e); }
  });

  ws.on('close', () => {
    console.log('Agent disconnected (ws):', clientId);
    wsClients.delete(clientId);
  });
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const clientId = url.searchParams.get('client_id');
  const secret = url.searchParams.get('secret');
  if (!clientId || secret !== AGENT_SECRET) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req, { clientId });
  });
});

function enqueueCommand(clientId, cmd) {
  const execId = crypto.randomBytes(8).toString('hex');
  const q = pending.get(clientId) || [];
  q.push({ id: execId, cmd });
  pending.set(clientId, q);
  // If ws connected, send immediately
  const ws = wsClients.get(clientId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: 'exec', id: execId, cmd })); } catch (e) {}
  }
  return execId;
}

// Admin enqueues a command and waits for result (works whether agent uses ws or polling)
app.post('/api/exec', async (req, res) => {
  const token = req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  const { client_id, cmd, timeout = 30000 } = req.body;
  if (!client_id || !cmd) return res.status(400).json({ error: 'client_id and cmd required' });

  const execId = enqueueCommand(client_id, cmd);
  results.set(execId, []);

  const start = Date.now();
  (function waitForExit() {
    const chunks = results.get(execId) || [];
    const foundExit = chunks.find(c => c.type === 'exit' && c.id === execId);
    if (foundExit) {
      return res.json({ id: execId, outputs: chunks });
    }
    if (Date.now() - start > timeout) {
      return res.status(504).json({ error: 'timeout', outputs: chunks });
    }
    setTimeout(waitForExit, 200);
  })();
});

// Admin can enqueue without waiting
app.post('/api/send', (req, res) => {
  const token = req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  const { client_id, cmd } = req.body;
  if (!client_id || !cmd) return res.status(400).json({ error: 'client_id and cmd required' });
  const execId = enqueueCommand(client_id, cmd);
  res.json({ id: execId });
});

// Agent polling endpoint (long-poll). Agent must authenticate with AGENT_SECRET header.
app.get('/api/poll', async (req, res) => {
  const secret = req.headers['x-agent-secret'] || (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);
  if (secret !== AGENT_SECRET) return res.status(403).json({ error: 'unauthorized' });
  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });

  const q = pending.get(clientId) || [];
  if (q.length > 0) {
    // return all queued commands and clear
    pending.delete(clientId);
    return res.json({ commands: q });
  }

  // Long-poll: wait up to 55s for new command
  let responded = false;
  const waitStart = Date.now();
  const interval = setInterval(() => {
    const q2 = pending.get(clientId) || [];
    if (q2.length > 0) {
      clearInterval(interval);
      if (!responded) {
        responded = true;
        pending.delete(clientId);
        return res.json({ commands: q2 });
      }
    }
    if (Date.now() - waitStart > 55000) {
      clearInterval(interval);
      if (!responded) {
        responded = true;
        return res.status(204).end();
      }
    }
  }, 500);

  // If client closes, cleanup
  req.on('close', () => { if (!responded) responded = true; clearInterval(interval); });
});

// Agent posts results
app.post('/api/result', (req, res) => {
  const secret = req.headers['x-agent-secret'] || (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);
  if (secret !== AGENT_SECRET) return res.status(403).json({ error: 'unauthorized' });
  const { id, client_id, stdout, stderr, code, type } = req.body;
  if (!id || !client_id) return res.status(400).json({ error: 'id and client_id required' });
  if (!results.has(id)) results.set(id, []);
  const entry = { id, client_id, type: type || (code !== undefined ? 'exit' : 'output'), stdout, stderr, code };
  results.get(id).push(entry);
  return res.json({ ok: true });
});

// Admin fetch outputs for an execId
app.get('/api/fetch/:id', (req, res) => {
  const token = req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  const id = req.params.id;
  res.json({ id, outputs: results.get(id) || [] });
});

app.get('/api/clients', (req, res) => {
  res.json({ ws_clients: Array.from(wsClients.keys()), queued_clients: Array.from(pending.keys()) });
});

server.listen(PORT, () => console.log('Server listening on', PORT));
