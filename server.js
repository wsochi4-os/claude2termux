require('dotenv').config();
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const WebSocket = require('ws');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const helmet = require('helmet');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin-token';
const AGENT_SECRET = process.env.AGENT_SECRET || 'change-me-agent-secret';
const PORT = process.env.PORT || 8080;
const TLS_CERT = process.env.TLS_CERT || '';
const TLS_KEY = process.env.TLS_KEY || '';
const DATA_DIR = process.env.DATA_DIR || './data';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const CLIENTS_FILE = DATA_DIR + '/clients.json';
if (!fs.existsSync(CLIENTS_FILE)) fs.writeFileSync(CLIENTS_FILE, JSON.stringify({}));

function loadClients(){ try { return JSON.parse(fs.readFileSync(CLIENTS_FILE)); } catch(e){ return {}; } }
function saveClients(obj){ fs.writeFileSync(CLIENTS_FILE, JSON.stringify(obj, null, 2)); }

const app = express();
app.use(require('cors')({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-agent-secret']
}));
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(express.json({limit: '2mb'}));
app.use(morgan('combined', {stream: fs.createWriteStream(DATA_DIR + '/access.log', {flags:'a'})}));

// Rate limiting for admin endpoints
const adminLimiter = rateLimit({ windowMs: 30*1000, max: 30 });

// Serve UI
app.use('/ui', express.static('public'));

// in-memory structures
const wsClients = new Map();
const pending = new Map();
const results = new Map();

function hmacSign(key, msg){ return crypto.createHmac('sha256', key).update(msg).digest('base64'); }

function enqueueCommand(clientId, cmd, auditMeta){
  const clients = loadClients();
  const clientKey = clients[clientId] && clients[clientId].key;
  const execId = crypto.randomBytes(8).toString('hex');
  const q = pending.get(clientId) || [];
  const sig = clientKey ? hmacSign(clientKey, execId + ':' + cmd) : null;
  q.push({ id: execId, cmd, sig });
  pending.set(clientId, q);
  const ws = wsClients.get(clientId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: 'exec', id: execId, cmd, sig })); } catch (e) {}
  }
  const entry = { time: new Date().toISOString(), clientId, execId, cmdPreview: cmd.slice(0,200), meta: auditMeta || {} };
  fs.appendFileSync(DATA_DIR + '/audit.log', JSON.stringify(entry) + '\n');
  return execId;
}

// Admin: add client key
app.post('/api/client', adminLimiter, (req, res) => {
  const token = req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  const { client_id, key } = req.body;
  if (!client_id || !key) return res.status(400).json({ error: 'client_id and key required' });
  const clients = loadClients();
  clients[client_id] = { key };
  saveClients(clients);
  res.json({ ok: true });
});

// Admin enqueue and wait
app.post('/api/exec', adminLimiter, (req, res) => {
  const token = req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  const { client_id, cmd, timeout = 30000 } = req.body;
  if (!client_id || !cmd) return res.status(400).json({ error: 'client_id and cmd required' });
  const execId = enqueueCommand(client_id, cmd, { by: 'admin' });
  results.set(execId, []);
  const start = Date.now();
  (function waitForExit(){
    const chunks = results.get(execId) || [];
    const foundExit = chunks.find(c => c.type === 'exit' && c.id === execId);
    if (foundExit) return res.json({ id: execId, outputs: chunks });
    if (Date.now() - start > timeout) return res.status(504).json({ error: 'timeout', outputs: chunks });
    setTimeout(waitForExit, 200);
  })();
});

app.post('/api/send', adminLimiter, (req, res)=>{
  const token = req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  const { client_id, cmd } = req.body; if (!client_id||!cmd) return res.status(400).json({ error:'client_id and cmd required' });
  const execId = enqueueCommand(client_id, cmd, { by: 'admin-send' });
  res.json({ id: execId });
});

// Agent long-poll
app.get('/api/poll', (req, res) => {
  const secret = req.headers['x-agent-secret'] || (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);
  if (secret !== AGENT_SECRET) return res.status(403).json({ error: 'unauthorized' });
  const clientId = req.query.client_id; if (!clientId) return res.status(400).json({ error: 'client_id required' });
  const q = pending.get(clientId) || [];
  if (q.length > 0){ pending.delete(clientId); return res.json({ commands: q }); }
  let responded = false; const waitStart = Date.now();
  const interval = setInterval(()=>{ const q2 = pending.get(clientId)||[]; if(q2.length>0){ clearInterval(interval); if(!responded){ responded=true; pending.delete(clientId); return res.json({commands:q2}); } } if(Date.now()-waitStart>55000){ clearInterval(interval); if(!responded){ responded=true; return res.status(204).end(); } } },500);
  req.on('close', ()=>{ if(!responded) responded=true; clearInterval(interval); });
});

// Agent posts results
app.post('/api/result', (req, res)=>{
  const secret = req.headers['x-agent-secret'] || (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);
  if (secret !== AGENT_SECRET) return res.status(403).json({ error: 'unauthorized' });
  const { id, client_id, stdout, stderr, code, type } = req.body;
  if (!id || !client_id) return res.status(400).json({ error: 'id and client_id required' });
  if (!results.has(id)) results.set(id, []);
  const entry = { id, client_id, type: type || (code!==undefined?'exit':'output'), stdout, stderr, code, time: new Date().toISOString() };
  results.get(id).push(entry);
  fs.appendFileSync(DATA_DIR + '/results.log', JSON.stringify(entry) + '\n');
  return res.json({ ok: true });
});

app.get('/api/fetch/:id', (req,res)=>{ const token = req.headers['authorization']?req.headers['authorization'].replace('Bearer ',''):null; if(token!==ADMIN_TOKEN) return res.status(403).json({error:'unauthorized'}); const id=req.params.id; res.json({id, outputs: results.get(id)||[]}); });

app.get('/api/clients', (req,res)=>{ const clients = loadClients(); res.json({ ws_clients: Array.from(wsClients.keys()), queued_clients: Array.from(pending.keys()), registered_clients: Object.keys(clients) }); });

app.get('/api/audit', (req,res)=>{ const token=req.headers['authorization']?req.headers['authorization'].replace('Bearer ',''):null; if(token!==ADMIN_TOKEN) return res.status(403).json({error:'unauthorized'}); const lines = fs.existsSync(DATA_DIR + '/audit.log')?fs.readFileSync(DATA_DIR + '/audit.log','utf8').trim().split('\n').slice(-200):[]; res.json(lines.map(l=>JSON.parse(l))); });

let server;
if (TLS_CERT && TLS_KEY && fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY)){
  const opts = { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) };
  server = https.createServer(opts, app);
  console.log('Starting HTTPS server');
} else {
  server = http.createServer(app);
  console.log('Starting HTTP server (use TLS in production)');
}

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req, clientInfo)=>{
  const clientId = clientInfo.clientId; console.log('Agent connected (ws):', clientId); wsClients.set(clientId, ws);
  ws.on('message', data=>{ try{ const m=JSON.parse(data.toString()); if(m.id){ if(!results.has(m.id)) results.set(m.id, []); results.get(m.id).push(m); fs.appendFileSync(DATA_DIR + '/results.log', JSON.stringify(m) + '\n'); } }catch(e){} });
  ws.on('close', ()=>{ wsClients.delete(clientId); console.log('Agent ws disconnected',clientId); });
});

server.on('upgrade', (req, socket, head)=>{ const url=new URL(req.url,'http://localhost'); const clientId=url.searchParams.get('client_id'); const secret=url.searchParams.get('secret'); if(!clientId || secret!==AGENT_SECRET){ socket.write('HTTP/1.1 401 Unauthorized\\r\\n\\r\\n'); socket.destroy(); return; } wss.handleUpgrade(req,socket,head,ws=>{ wss.emit('connection', ws, req, { clientId }); }); });

server.listen(PORT, ()=>console.log('Server listening on', PORT));
