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
const Anthropic = require('@anthropic-ai/sdk');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin-token';
const AGENT_SECRET = process.env.AGENT_SECRET || 'change-me-agent-secret';
const PORT = process.env.PORT || 8080;
const TLS_CERT = process.env.TLS_CERT || '';
const TLS_KEY = process.env.TLS_KEY || '';
const DATA_DIR = process.env.DATA_DIR || './data';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CHAT_MODEL = process.env.CHAT_MODEL || 'claude-3-5-sonnet-20240620';
const CHAT_MAX_TURNS = parseInt(process.env.CHAT_MAX_TURNS || '10');

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

// ── Admin Endpoints ──────────────────────────────────────────────────────────

app.post('/api/client', adminLimiter, (req, res) => {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  const { client_id, key } = req.body;
  if (!client_id || !key) return res.status(400).json({ error: 'client_id and key required' });
  const clients = loadClients();
  clients[client_id] = { key };
  saveClients(clients);
  res.json({ ok: true });
});

app.post('/api/exec', adminLimiter, (req, res) => {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  const { client_id, cmd, timeout = 30000 } = req.body;
  if (!client_id || !cmd) return res.status(400).json({ error: 'client_id and cmd required' });
  const execId = enqueueCommand(client_id, cmd, { by: 'admin' });
  results.set(execId, []);
  
  waitForResult(execId, timeout).then(output => {
    res.json({ id: execId, outputs: results.get(execId) });
  });
});

app.post('/api/send', adminLimiter, (req, res)=>{
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  const { client_id, cmd } = req.body; if (!client_id||!cmd) return res.status(400).json({ error:'client_id and cmd required' });
  const execId = enqueueCommand(client_id, cmd, { by: 'admin-send' });
  res.json({ id: execId });
});

// ── Agent Endpoints ──────────────────────────────────────────────────────────

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

app.post('/api/result', (req, res)=>{
  const secret = req.headers['x-agent-secret'] || (req.headers['authorization'] ? req.headers['authorization'].replace('Bearer ', '') : null);
  if (secret !== AGENT_SECRET) return res.status(403).json({ error: 'unauthorized' });
  let { id, client_id, stdout, stderr, code, type } = req.body;
  if (!id || !client_id) return res.status(400).json({ error: 'id and client_id required' });

  // Attempt to decode base64 stdout if it looks like it
  if (stdout && /^[A-Za-z0-9+/=]+$/.test(stdout)) {
    try { stdout = Buffer.from(stdout, 'base64').toString('utf8'); } catch(e) {}
  }

  if (!results.has(id)) results.set(id, []);
  const entry = { id, client_id, type: type || (code!==undefined?'exit':'output'), stdout, stderr, code, time: new Date().toISOString() };
  results.get(id).push(entry);
  fs.appendFileSync(DATA_DIR + '/results.log', JSON.stringify(entry) + '\n');
  return res.json({ ok: true });
});

// ── Agentic Chat ───────────────────────────────────────────────────────────

app.post('/api/chat', adminLimiter, async (req, res) => {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'unauthorized' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });

  const { message, client_id, history = [] } = req.body;
  if (!message || !client_id) return res.status(400).json({ error: 'message and client_id are required' });

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const tools = [
    {
      name: 'run_command',
      description:
        'Execute a shell command on the connected Termux Android device and return the output. ' +
        'Use this to inspect files, run scripts, check system state, install packages, etc.',
      input_schema: {
        type: 'object',
        properties: {
          cmd: { type: 'string', description: 'The shell command to run (executed via sh -c)' }
        },
        required: ['cmd']
      }
    },
    {
      name: 'termux_api',
      description: 'Interact with Android device features via Termux:API.',
      input_schema: {
        type: 'object',
        properties: {
          command: { 
            type: 'string', 
            enum: ['clipboard-get', 'clipboard-set', 'battery-status', 'vibrate', 'notification', 'location'],
            description: 'The Termux:API feature to use' 
          },
          args: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Arguments for the command (e.g., text for clipboard-set, title/content for notification)'
          }
        },
        required: ['command']
      }
    }
  ];

  const systemPrompt =
    `You are a helpful assistant with direct shell access to an Android device running Termux ` +
    `(client_id: "${client_id}"). ` +
    `Use the run_command tool freely to inspect the device, run scripts, fix errors, and verify results. ` +
    `Always check actual output rather than assuming. ` +
    `When a task requires multiple steps, run them one at a time and adapt based on real output. ` +
    `Be concise — the user is on mobile.`;

  const messages = [...history, { role: 'user', content: message }];

  try {
    let finalResponse = null;

    for (let turn = 0; turn < CHAT_MAX_TURNS; turn++) {
      const apiResponse = await anthropic.messages.create({
        model: CHAT_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages
      });

      messages.push({ role: 'assistant', content: apiResponse.content });

      if (apiResponse.stop_reason === 'end_turn' || apiResponse.stop_reason === 'stop_sequence') {
        finalResponse = apiResponse;
        break;
      }

      if (apiResponse.stop_reason === 'tool_use') {
        const toolResults = [];
        for (const block of apiResponse.content) {
          if (block.type !== 'tool_use') continue;

          let cmd = '';
          if (block.name === 'run_command') {
            cmd = block.input.cmd;
          } else if (block.name === 'termux_api') {
            const apiCmd = block.input.command;
            const args = (block.input.args || []).map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ');
            cmd = `./termux_api_wrapper.sh ${apiCmd} ${args}`;
          } else {
            continue;
          }

          console.log(`[chat] tool: ${block.name} -> ${cmd}`);
          const execId = enqueueCommand(client_id, cmd, { by: 'chat-agent', tool: block.name });
          results.set(execId, []);
          const output = await waitForResult(execId, 30000);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `exit_code: ${output.code}\n${output.text}`
          });
        }


        messages.push({ role: 'user', content: toolResults });
      } else {
        finalResponse = apiResponse;
        break;
      }
    }

    if (!finalResponse) {
      return res.status(500).json({ error: 'Agent reached max turns without a final response.' });
    }

    const responseText = finalResponse.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return res.json({ response: responseText, history: messages });

  } catch (err) {
    console.error('[chat] error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ── Utility ──────────────────────────────────────────────────────────────────

function waitForResult(execId, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const chunks = results.get(execId) || [];
      const exitChunk = chunks.find(c => c.type === 'exit' && c.id === execId);
      if (exitChunk) {
        clearInterval(timer);
        let text = '';
        for (const c of chunks) {
          if (c.stdout) {
            try {
              if (/^[A-Za-z0-9+/=]+$/.test(c.stdout)) {
                text += Buffer.from(c.stdout, 'base64').toString('utf8');
              } else {
                text += c.stdout;
              }
            } catch { text += c.stdout; }
          }
          if (c.stderr) {
            try {
              if (/^[A-Za-z0-9+/=]+$/.test(c.stderr)) {
                text += Buffer.from(c.stderr, 'base64').toString('utf8');
              } else {
                text += c.stderr;
              }
            } catch { text += c.stderr; }
          }
        }
        resolve({ text: text.trim() || '(no output)', code: exitChunk.code ?? 0 });
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        const chunks = results.get(execId) || [];
        let text = `(command timed out after ${Math.round(timeoutMs/1000)}s)`;
        for (const c of chunks) {
          if (c.stdout) { try { text += "\n" + Buffer.from(c.stdout, 'base64').toString('utf8'); } catch { text += "\n" + c.stdout; } }
          if (c.stderr) { try { text += "\n" + Buffer.from(c.stderr, 'base64').toString('utf8'); } catch { text += "\n" + c.stderr; } }
        }
        resolve({ text: text.trim(), code: -1 });
      }
    }, 200);
  });
}

app.get('/api/fetch/:id', (req,res)=>{ const token = (req.headers['authorization'] || '').replace('Bearer ', ''); if(token!==ADMIN_TOKEN) return res.status(403).json({error:'unauthorized'}); const id=req.params.id; res.json({id, outputs: results.get(id)||[]}); });

app.get('/api/clients', (req,res)=>{ const clients = loadClients(); res.json({ ws_clients: Array.from(wsClients.keys()), queued_clients: Array.from(pending.keys()), registered_clients: Object.keys(clients) }); });

app.get('/api/audit', (req,res)=>{ const token=(req.headers['authorization'] || '').replace('Bearer ', ''); if(token!==ADMIN_TOKEN) return res.status(403).json({error:'unauthorized'}); const lines = fs.existsSync(DATA_DIR + '/audit.log')?fs.readFileSync(DATA_DIR + '/audit.log','utf8').trim().split('\n').slice(-200):[]; res.json(lines.map(l=>JSON.parse(l))); });

let server;
if (TLS_CERT && TLS_KEY && fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY)){
  const opts = { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) };
  server = https.createServer(opts, app);
  console.log('Starting HTTPS server');
} else {
  server = http.createServer(app);
  console.log('Starting HTTP server (use TLS or Cloudflare Tunnel in production)');
}

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req, clientInfo)=>{
  const clientId = clientInfo.clientId; console.log('Agent connected (ws):', clientId); wsClients.set(clientId, ws);
  ws.on('message', data=>{ try{ const m=JSON.parse(data.toString()); if(m.id){ if(!results.has(m.id)) results.set(m.id, []); results.get(m.id).push(m); fs.appendFileSync(DATA_DIR + '/results.log', JSON.stringify(m) + '\n'); } }catch(e){} });
  ws.on('close', ()=>{ wsClients.delete(clientId); console.log('Agent ws disconnected',clientId); });
});

server.on('upgrade', (req, socket, head)=>{ const url=new URL(req.url,'http://localhost'); const clientId=url.searchParams.get('client_id'); const secret=url.searchParams.get('secret'); if(!clientId || secret!==AGENT_SECRET){ socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; } wss.handleUpgrade(req,socket,head,ws=>{ wss.emit('connection', ws, req, { clientId }); }); });

server.listen(PORT, ()=>console.log(`claude2termux listening on port ${PORT}`));
