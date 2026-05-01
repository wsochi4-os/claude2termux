Superpowers — Termux reverse-WebSocket bridge

Overview
1) Run the Node.js server on a publicly reachable host (or behind a TLS proxy).
2) Run the agent (agent.py) on Termux; it opens an outbound websocket to the server.
3) Use the HTTP API (/api/exec) with an ADMIN_TOKEN to send commands to the Termux client and receive outputs.

Quick start
- On server: export ADMIN_TOKEN=your_admin_token AGENT_SECRET=your_agent_secret PORT=8080 && npm install && node server.js
- On Termux: pkg install python && pip install websockets && export SERVER="ws://your-server:8080" CLIENT_ID="termux-1" AGENT_SECRET="your_agent_secret" && python3 agent.py

Security
- Keep ADMIN_TOKEN and AGENT_SECRET secret. Use TLS in production (wss://) and strong tokens.

This repo contains a minimal PoC. Adapt for your use-case (authentication, encryption, streaming, file transfer, rate-limiting).
