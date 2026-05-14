# Claude2Termux 🚀
**Bridge the gap between your LLM and your Android environment.**

Claude2Termux is a reverse-proxy bridge that allows cloud-based LLMs (like Claude, Gemini, or GPT-4) to execute commands directly inside your Termux terminal. It provides an MCP-like (Model Context Protocol) interface, allowing an AI to treat your phone as its local execution environment.

## 🏗️ How it Works
1.  **Agent (Termux)**: A lightweight agent (Python) runs on your phone, maintaining a persistent WebSocket connection to the server and executing commands.
2.  **Server (Cloud)**: An Express.js gateway (typically hosted behind a Cloudflare Tunnel or VPS). It queues commands for the phone and routes results back to the caller.
3.  **Controller (LLM/You)**: You or an AI agent sends commands to the Server API. The server pipes them to Termux, and the output flows back to the AI for reasoning.

## ✨ New Features & Enhancements
- **Robust Command Execution**: Commands now include execution timeouts to prevent indefinite hangs, and the Python agent features exponential backoff for WebSocket reconnection.
- **Enhanced Security**: HMAC verification is now consistently applied in both Python and Bash agents, and JSON parsing in the Bash agent has been made more robust. Server-side handling of stdout/stderr has been improved to correctly decode base64 outputs.
- **Termux:API Integration**: Direct access to Termux:API functions via sanitized wrappers, allowing LLMs to interact with device features like clipboard, battery status, and notifications.

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

**Python Agent (Recommended)**
```bash
pkg install python python-pip openssl
pip install websockets

export SERVER="ws://your-server-url:8080" # Use ws:// or wss:// depending on your server setup
export CLIENT_ID="termux-main"
export AGENT_SECRET="your_secure_agent_secret"
export CLIENT_KEY="your_client_hmac_key"

# Make the API wrapper executable
chmod +x termux_api_wrapper.sh

python agent.py
```

**Bash Agent (Legacy Polling)**
```bash
pkg install curl openssl coreutils

export SERVER="http://your-server-url:8080" # Use http:// or https:// depending on your server setup
export CLIENT_ID="termux-main"
export AGENT_SECRET="your_secure_agent_secret"
export CLIENT_KEY="your_client_hmac_key"
export TIMEOUT_VAL=60 # Optional: set command timeout in seconds (default 60)

# Make the API wrapper executable
chmod +x termux_api_wrapper.sh

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

### Using Termux:API via the Chat Agent
When interacting with the `/api/chat` endpoint, the LLM can now directly call Termux:API functions using the `termux_api` tool. For example, to get the clipboard content:

```json
{
  "tool_code": "termux_api",
  "parameters": {
    "command": "clipboard-get"
  }
}
```

To set the clipboard:

```json
{
  "tool_code": "termux_api",
  "parameters": {
    "command": "clipboard-set",
    "args": ["Hello from Claude!"]
  }
}
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
- **Command Timeouts**: Prevents agents from hanging indefinitely.

## 📄 License
MIT
