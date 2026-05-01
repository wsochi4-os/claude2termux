Superpowers — Termux-friendly reverse bridge (HTTP long-poll)

Overview
This version uses HTTP long-polling so Termux (no special libs) can poll for commands and post back results using curl. No Docker required on Termux.

Server (public host)
- Set ADMIN_TOKEN and AGENT_SECRET env vars.
- npm install && node server.js
- Endpoints:
  - POST /api/exec (admin) {client_id, cmd} waits for result
  - POST /api/send (admin) {client_id, cmd} enqueue only
  - GET /api/fetch/:id (admin) fetch outputs
  - GET /api/poll?client_id=... (agent) long-poll for commands
  - POST /api/result (agent) post outputs

Termux agent (no Python required)
- On Termux: pkg install curl coreutils
- Edit agent.sh: set SERVER, CLIENT_ID, AGENT_SECRET
- Start: ./agent.sh & or use Termux:Boot/Termux:Widget to run

Security
- Use HTTPS for SERVER (recommended).
- Keep ADMIN_TOKEN and AGENT_SECRET secret.

