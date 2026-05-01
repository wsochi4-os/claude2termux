# Claude2Termux 🚀
**Bridge the gap between your LLM and your Android environment.**

Claude2Termux is a reverse-proxy bridge that allows cloud-based LLMs (like Claude, Gemini, or GPT-4) to execute commands directly inside your Termux terminal. It provides an MCP-like (Model Context Protocol) interface, allowing an AI to treat your phone as its local execution environment.

## 🏗️ How it Works
1.  **Agent (Termux)**: A lightweight polling script (Python or Bash) runs on your phone. It reaches out to the server and waits for commands.
2.  **Server (Cloud)**: An Express.js gateway (typically hosted behind a Cloudflare Tunnel or VPS). It holds a queue of commands for the phone and routes results back to the caller.
3.  **Controller (LLM/You)**: You or an AI agent sends commands to the Server API. The server pipes them to Termux, and the output flows back to the AI for reasoning.

## 📦 Installation

### 1. Server Setup (VPS or Cloud)
```bash
git clone https://github.com/wsochi4-os/claude2termux
cd claude2termux
npm install

# Configure your secrets
cp .env.example .env 
# Edit .env with your ADMIN_TOKEN, AGENT_SECRET, and DATA_DIR

npm start
```

### 2. Termux Setup (The Agent)
In your Termux terminal:

**Option A: Python Agent (Recommended)**
```bash
pkg install python requests
export SERVER="https://your-server-url"
export CLIENT_ID="termux-main"
export AGENT_SECRET="your_secure_agent_secret"
export CLIENT_KEY="your_client_hmac_key"

python agent_new.py
```

**Option B: Bash Agent**
```bash
pkg install curl openssl
export SERVER="https://your-server-url"
export CLIENT_ID="termux-main"
export AGENT_SECRET="your_secure_agent_secret"
export CLIENT_KEY="your_client_hmac_key"

bash agent.sh
```

## 🛠 Usage (The "MCP" Experience)

### 📱 Connecting to Claude Android App (Artifacts)
To control Termux from your Claude Android app, copy and paste this prompt into a new chat once your server is running:

> "Create a React Artifact that acts as a 'Termux Remote Dashboard'. It should connect to my server at `{YOUR_SERVER_URL}`. Include a field for my `ADMIN_TOKEN`. The UI should have a command input, a terminal output area, and quick-action buttons for 'ls', 'top', and 'pkg upgrade'. Style it with a dark 'Termux' aesthetic. Ensure it sends commands via POST to `/api/exec` with the Bearer token header."

### Send a Command via CLI
```bash
curl -X POST https://your-server-url/api/exec \
  -H "Authorization: Bearer your_secure_admin_token" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "termux-main", "cmd": "ls /sdcard/Download"}'
```

### Integrated with Claude Code / Artifacts
You can define a custom tool in your AI environment that hits the `/api/exec` endpoint. This allows Claude to:
- Run `apt update` on your phone.
- Read files from your Termux storage.
- Trigger Android intents (if Termux-API is installed).

## 🔒 Security
- **HMAC Signing**: All commands are signed and verified via `CLIENT_KEY` to ensure they originated from your trusted server.
- **JWT/Token Auth**: Admin endpoints are protected by a Bearer token.
- **Rate Limiting**: Protection against brute-force attacks.

## 📄 License
MIT
