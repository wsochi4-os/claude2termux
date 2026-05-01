Cloudflare Tunnel quick setup (recommended for HTTPS)

Quick ephemeral tunnel (no DNS):
1. Install cloudflared on your server: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation
2. Run a short-lived tunnel that exposes your local server with a public URL:
   cloudflared tunnel --url http://localhost:8080

The command prints a publicly reachable https://...trycloudflare.com URL you can put in SERVER for the agent and use in the web UI.

Persistent named tunnel (recommended for production):
1. Authenticate cloudflared with your Cloudflare account (one-time):
   cloudflared login
2. Create a named tunnel:
   cloudflared tunnel create claude2termux
3. Configure DNS to map a hostname (example: claude.example.com) to the tunnel:
   cloudflared tunnel route dns claude2termux claude.example.com
4. Run the tunnel:
   cloudflared tunnel run claude2termux

Run cloudflared as a systemd service (example snippet):
[Unit]
Description=cloudflared tunnel
After=network.target

[Service]
User=root
ExecStart=/usr/local/bin/cloudflared tunnel run claude2termux
Restart=on-failure

[Install]
WantedBy=multi-user.target

Security notes:
- Use the persistent named tunnel + DNS for stable hostnames and TLS.
- Keep ADMIN_TOKEN and AGENT_SECRET secret; never embed them in public URLs or untrusted apps.
