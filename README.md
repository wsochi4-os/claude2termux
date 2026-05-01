claude2termux — Simple bridge for Claude (Android) → Termux (HTTP long-poll)

Plain English summary (ELI16)
This project lets a cloud controller (like Claude's Android app) tell a Termux device to run shell commands. The Termux device polls the server for commands and posts back results. No Docker or special root access required on Termux — just curl and coreutils.

Overview
- Server (public): Node.js app (server.js) that stores commands and results.
- Agent (Termux): agent.sh — a tiny shell script that long-polls the server with curl, runs commands locally, and posts back base64-encoded outputs.
- Security: uses shared secrets (ADMIN_TOKEN for admin API calls, AGENT_SECRET for agent authentication). Use HTTPS in production.

Quick checklist before starting
1) A public server or tunnel (example: a VPS, Cloudflare Tunnel)
2) Node.js (v16+) on the server
3) Termux on Android with curl and coreutils installed
4) Pick two long random secrets: ADMIN_TOKEN and AGENT_SECRET

Server — step-by-step (on your host)
1. Clone or download the repo and cd into it.
2. Install deps:
   npm install
3. Set environment variables (example):
   export ADMIN_TOKEN="a-long-random-token"
   export AGENT_SECRET="another-long-secret"
   export PORT=8080   # optional
4. Start the server:
   node server.js
5. Confirm server is reachable (replace HOST):
   curl -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"client_id":"test","cmd":"echo hi"}' -H "Content-Type: application/json" https://HOST/api/send
   (you should get back an id)
6. View connected clients and queued clients:
   curl https://HOST/api/clients

Termux device — step-by-step
1. Install Termux and open a session.
2. Install required packages:
   pkg update -y
   pkg install curl coreutils -y
3. Edit agent.sh in the repo (or copy it to Termux) and set these env vars at top:
   SERVER="https://YOUR_SERVER_OR_TUNNEL"
   CLIENT_ID="termux-myphone"   # any unique id
   AGENT_SECRET="the-same-agent-secret-you-set-on-server"
4. Make it executable and run it in background:
   chmod +x agent.sh
   nohup ./agent.sh >/dev/null 2>&1 &
   (Or use Termux:Boot or Termux:Widget to start on boot)
5. Confirm polling: check server logs or GET /api/clients on server

How to send a command from Claude (or any HTTP client)
- Endpoint: POST https://YOUR_SERVER/api/exec
- Header: Authorization: Bearer YOUR_ADMIN_TOKEN
- JSON body: {"client_id":"termux-myphone","cmd":"ls -la /data/data"}
- Example curl (server-side test):
  curl -s -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"client_id":"termux-myphone","cmd":"ls -la"}' https://HOST/api/exec
- Response structure:
  { "id": "execid", "outputs": [ {"id":"execid","client_id":"termux-myphone","type":"output","stdout":"BASE64..."}, {"id":"execid","client_id":"termux-myphone","type":"exit","code":0} ] }
- Decode outputs on your side (Base64):
  echo "BASE64STRING" | base64 -d

Notes for using Claude Android app
- Claude itself cannot natively run curl; but you can:
  - Use Claude to compose the JSON body and then use an HTTP shortcut app (e.g., Termux:Tasker, HTTP Shortcuts) to POST it.
  - Or use a web UI / simple HTTP client that you can call from Claude (if Claude supports webhooks) to forward the request.
- Keep the ADMIN_TOKEN secret. Do not paste it into public chats.

Troubleshooting
- If agent never appears: ensure SERVER is reachable from Android and AGENT_SECRET matches.
- If /api/exec times out: check agent output and server logs; ensure agent posted result to /api/result.
- If outputs are unreadable: remember agent.sh base64-encodes stdout; decode with base64 -d.

Security recommendations (short)
- Use HTTPS (obvious). Use Cloudflare Tunnel or a proper TLS cert.
- Rotate ADMIN_TOKEN/AGENT_SECRET regularly.
- Limit server to allowlist IPs where possible; add rate-limiting if you expose publicly.

Example minimal flow (quick)
1. Start server on HOST with ADMIN_TOKEN/AGENT_SECRET.
2. Start agent on Termux with same AGENT_SECRET and CLIENT_ID.
3. From controller: POST /api/exec with Authorization header and {client_id, cmd}.
4. Server returns outputs (base64 stdout). Decode locally to read command result.

If anything is unclear or you want: a ready-made HTTPS shortcut for Claude, a tiny admin web UI, or a version of agent that uses jq for safer parsing — say which and I’ll add it.

