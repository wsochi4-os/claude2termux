require('dotenv').config();
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const crypto = require('crypto');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin-token';
const AGENT_SECRET = process.env.AGENT_SECRET || 'change-me-agent-secret';
const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json());

// clients: clientId => ws
const clients = new Map();

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req, clientInfo) => {
  const clientId = clientInfo.clientId;
  console.log('Agent connected:', clientId);
  clients.set(clientId, ws);

  ws.on('message', data => {
    // simple passthrough logging
    try {
      const msg = JSON.parse(data.toString());
      console.log('From', clientId, msg);
    } catch (e) {
      console.log('Raw from', clientId, data.toString());
    }
  });

  ws.on('close', () => {
    console.log('Agent disconnected:', clientId);
    clients.delete(clientId);
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

// Send a command to a connected client and wait for reply
app.post('/api/exec', async (req, res) => {
  const token = req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  const { client_id, cmd, timeout = 30000 } = req.body;
  if (!client_id || !cmd) return res.status(400).json({ error: 'client_id and cmd required' });
  const ws = clients.get(client_id);
  if (!ws || ws.readyState !== WebSocket.OPEN) return res.status(404).json({ error: 'client not connected' });

  const execId = crypto.randomBytes(8).toString('hex');
  const chunks = [];

  const onMessage = message => {
    try {
      const m = JSON.parse(message.toString());
      if (m.type === 'output' && m.id === execId) {
        chunks.push(m);
      }
    } catch (e) { }
  };

  ws.on('message', onMessage);

  ws.send(JSON.stringify({ type: 'exec', id: execId, cmd }));

  const start = Date.now();
  (function waitForExit() {
    const foundExit = chunks.find(c => c.type === 'exit' && c.id === execId);
    if (foundExit) {
      ws.removeListener('message', onMessage);
      return res.json({ outputs: chunks });
    }
    if (Date.now() - start > timeout) {
      ws.removeListener('message', onMessage);
      return res.status(504).json({ error: 'timeout', outputs: chunks });
    }
    setTimeout(waitForExit, 200);
  })();
});

app.get('/api/clients', (req, res) => {
  res.json({ clients: Array.from(clients.keys()) });
});

server.listen(PORT, () => console.log('Server listening on', PORT));
