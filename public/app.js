function b64decode(s){try{ // handle base64 utf8
  const bin = atob(s); // binary string
  // decode UTF-8
  const bytes = Uint8Array.from(bin.split('').map(c=>c.charCodeAt(0)));
  const dec = new TextDecoder().decode(bytes);
  return dec;
}catch(e){return '[decode error]'+e}}

const tokenInput = document.getElementById('token');
const saveBtn = document.getElementById('save-token');
const main = document.getElementById('main');
const clientsSel = document.getElementById('clients');
const refreshBtn = document.getElementById('refresh');
const sendBtn = document.getElementById('send');
const sendNoWaitBtn = document.getElementById('send-no-wait');
const cmdInput = document.getElementById('cmd');
const outputEl = document.getElementById('output');

function setToken(t){localStorage.setItem('claude2token', t); tokenInput.value=''; showMain();}
function getToken(){return localStorage.getItem('claude2token')}
function showMain(){const t = getToken(); if(t){document.getElementById('login').style.display='none'; main.style.display='block'; refreshClients();} else {document.getElementById('login').style.display='block'; main.style.display='none';}}

saveBtn.onclick = ()=>{const v = tokenInput.value.trim(); if(!v){alert('enter token');return} setToken(v)};

async function fetchClients(){const token = getToken(); if(!token) return; try{
  const r = await fetch('/api/clients', {headers: {Authorization: 'Bearer '+token}});
  if(!r.ok) throw new Error('fetch clients failed')
  const j = await r.json();
  const list = (j.ws_clients||[]).concat(j.queued_clients||[]);
  clientsSel.innerHTML='';
  list.forEach(c=>{const o=document.createElement('option'); o.value=c; o.textContent=c; clientsSel.appendChild(o)});
}catch(e){alert('Error fetching clients: '+e.message)} }

function refreshClients(){fetchClients();}
refreshBtn.onclick = refreshClients;

async function sendCommand(wait=true){const token = getToken(); if(!token){alert('set token');return}
  const client_id = clientsSel.value || prompt('client_id');
  if(!client_id) return;
  const cmd = cmdInput.value.trim(); if(!cmd){alert('enter command');return}
  outputEl.textContent = 'Sending...';
  try{
    const r = await fetch('/api/exec', {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body:JSON.stringify({client_id, cmd, timeout:30000})});
    if(!r.ok){const txt=await r.text(); throw new Error(txt||'request failed');}
    const j = await r.json();
    // j.outputs is array of outputs
    const outs = j.outputs || j.outputs === undefined ? j.outputs : j.outputs; // safety
    // If outputs are present, decode
    let text = '';
    if(j.outputs && j.outputs.length){
      j.outputs.forEach(e=>{
        if(e.stdout){ text += b64decode(e.stdout) + '\n'; }
        if(e.stderr){ text += '[stderr]\n' + b64decode(e.stderr) + '\n'; }
        if(e.type==='exit' && e.code!==undefined){ text += '[exit code] '+e.code+'\n'; }
      });
    } else {
      // fallback: when server returns {id, outputs}
      if(j.outputs){ j.outputs.forEach(e=>{ if(e.stdout){ text += b64decode(e.stdout)+'\n'} }); }
    }
    outputEl.textContent = text || JSON.stringify(j, null, 2);
  }catch(err){outputEl.textContent = 'Error: '+err.message}
}

sendBtn.onclick = ()=>sendCommand(true);
sendNoWaitBtn.onclick = async ()=>{
  const token = getToken(); if(!token){alert('set token');return}
  const client_id = clientsSel.value || prompt('client_id'); if(!client_id) return;
  const cmd = cmdInput.value.trim(); if(!cmd){alert('enter command');return}
  try{
    const r = await fetch('/api/send', {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body:JSON.stringify({client_id, cmd})});
    const j = await r.json(); outputEl.textContent = 'Enqueued id: '+(j.id||'unknown');
  }catch(e){outputEl.textContent = 'Error: '+e.message}
}

showMain();

// Try auto-show main if token in storage
if(getToken()) showMain();
