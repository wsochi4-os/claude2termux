const tokenInput = document.getElementById('token');
const saveBtn = document.getElementById('save-token');
const main = document.getElementById('main');
const clientsSel = document.getElementById('clients');
const refreshBtn = document.getElementById('refresh');
const cmdInput = document.getElementById('cmd');
const sendBtn = document.getElementById('send');
const outputEl = document.getElementById('output');

function getToken() { return localStorage.getItem('claude2token'); }
function setToken(t) { localStorage.setItem('claude2token', t); showMain(); }

function showMain() {
    const t = getToken();
    if (t) {
        document.getElementById('login').style.display = 'none';
        main.style.display = 'block';
        fetchClients();
    } else {
        document.getElementById('login').style.display = 'block';
        main.style.display = 'none';
    }
}

saveBtn.onclick = () => {
    const v = tokenInput.value.trim();
    if (!v) return;
    setToken(v);
};

async function fetchClients() {
    const token = getToken();
    try {
        const r = await fetch('/api/clients', { headers: { Authorization: 'Bearer ' + token } });
        const j = await r.json();
        const list = Array.from(new Set((j.ws_clients || []).concat(j.queued_clients || []).concat(j.registered_clients || [])));
        clientsSel.innerHTML = '';
        list.forEach(c => {
            const o = document.createElement('option');
            o.value = c;
            o.textContent = c;
            clientsSel.appendChild(o);
        });
    } catch (e) {
        log('Error fetching clients: ' + e.message, 'error');
    }
}

refreshBtn.onclick = fetchClients;

function log(text, type = '') {
    const line = document.createElement('div');
    line.className = 'line ' + type;
    line.textContent = text;
    outputEl.appendChild(line);
    document.querySelector('.terminal-container').scrollTop = outputEl.scrollHeight;
}

function clearOutput() { outputEl.innerHTML = ''; }

async function sendCommand(command = null) {
    const token = getToken();
    const client_id = clientsSel.value;
    const cmd = command || cmdInput.value.trim();
    
    if (!client_id || !cmd) return;
    if (!command) cmdInput.value = '';

    log('λ ' + cmd, 'cmd-echo');

    try {
        const r = await fetch('/api/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ client_id, cmd, timeout: 30000 })
        });
        const j = await r.json();
        
        if (j.outputs) {
            j.outputs.forEach(o => {
                if (o.stdout) log(o.stdout);
                if (o.stderr) log(o.stderr, 'error');
                if (o.type === 'exit') log('[process exited with code ' + o.code + ']', 'system');
            });
        }
    } catch (e) {
        log('Error: ' + e.message, 'error');
    }
}

function quickCmd(c) { sendCommand(c); }

sendBtn.onclick = () => sendCommand();
cmdInput.onkeydown = (e) => { if (e.key === 'Enter') sendCommand(); };

showMain();
