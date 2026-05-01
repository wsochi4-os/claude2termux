# claude2termux — Control Termux from Claude (Android)

A minimal, Termux-friendly bridge that lets a cloud controller (e.g., Claude Android app) send shell commands to Termux devices. Termux polls the server (long-poll), runs commands locally, and returns base64-encoded results.

Quick start (ELI16)
1. Pick secrets and a host
   - ADMIN_TOKEN (server admin) — keep secret
   - AGENT_SECRET (agent auth) — keep secret
   - Choose HOST (your VPS or a tunnel URL from Cloudflare Tunnel)

2. On the server (VPS)
   - Clone the repo and install: npm install
   - Create a .env or export env vars:
     ADMIN_TOKEN="<long-secret>"
     AGENT_SECRET="<long-secret>"
     PORT=8080
   - Start server (foreground): ./claude2t start
     or background: ./claude2t start-daemon

3. Register a per-client key (server-side)
   - Create a per-device CLIENT_KEY (random string) and register it:
     curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
       -d '{"client_id":"termux-phone","key":"<CLIENT_KEY>"}' https://$HOST/api/client

4. On Termux (your Android device)
   - Install: pkg update && pkg install curl openssl coreutils -y
   - Copy agent.sh to Termux and set env vars:
     export SERVER="https://$HOST"
     export CLIENT_ID="termux-phone"
     export AGENT_SECRET="<AGENT_SECRET>"
     export CLIENT_KEY="<CLIENT_KEY>"
   - Run agent:
     chmod +x agent.sh
     ./agent.sh &

5. Send commands (from phone / Claude / web UI)
   - Use the web UI: https://$HOST/ui (enter ADMIN_TOKEN)
   - Or CURL / HTTP shortcut: POST https://$HOST/api/exec
     Headers: Authorization: Bearer <ADMIN_TOKEN>
     Body: {"client_id":"termux-phone","cmd":"ls -la"}

6. Read outputs
   - Server returns id and outputs array with base64 stdout/stderr. Decode with:
     echo "BASE64" | base64 -d

Cloudflare Tunnel (quick)
- Quick ephemeral (no account): run:
  cloudflared tunnel --url http://localhost:8080
  — you get a https://*.trycloudflare.com URL immediately.

- Persistent hostname (recommended):
  1) cloudflared login
  2) cloudflared tunnel create <NAME>
  3) cloudflared tunnel route dns <NAME> <HOSTNAME>
  4) Use .cloudflared/config.yml and systemd/cloudflared.service to run persistently (see repo files)

Security notes
- Use HTTPS (Cloudflare Tunnel or TLS certs).
- ADMIN_TOKEN and AGENT_SECRET must be strong and kept secret.
- Register per-client CLIENT_KEY and keep it on the device only.
- Review logs (data/) and rotate keys regularly.

Troubleshooting (quick)
- Agent not connecting: verify SERVER URL, AGENT_SECRET, and network.
- /api/exec times out: check agent logs and server data/results.log.
- Outputs unreadable: decode base64.

Files of interest
- server.js — server implementation
- agent.sh — Termux agent (HMAC verify)
- public/ — web UI (visit /ui)
- claude2t — start/stop helper
- systemd/claude2termux.service — systemd template
- .cloudflared/config.yml & systemd/cloudflared.service — cloudflared templates

If you want, I can:
- Populate cloudflared config with your hostname, or
- Add a small admin UI auth session, or
- Create automated install scripts for a VPS.
