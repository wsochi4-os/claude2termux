# 🤖 Agentic Chat — Claude with Real Termux Access

This adds a `/api/chat` endpoint to your server. When you send Claude a message, it can **actually run shell commands on your Termux device** and reason about the real output — not just guess.

## How it works

```
You (Android app / HTTP Shortcut)
        │  POST /api/chat  { message, client_id }
        ▼
   server.js  ──► Claude API (claude-sonnet)
        │               │
        │    tool_use: run_command("ls /sdcard")
        │               │
        ├── enqueueCommand() ──► Termux agent polls, runs cmd
        │                              │
        │◄──────── /api/result ◄───────┘
        │
   Claude sees real output, reasons, replies
        │
        ▼
   { response: "...", history: [...] }
```

## Setup

### 1. Add your Anthropic API key to `.env`

```env
ADMIN_TOKEN=your-admin-token
AGENT_SECRET=your-agent-secret
PORT=8080
ANTHROPIC_API_KEY=sk-ant-...        # ← add this line
```

Get a key at: https://console.anthropic.com/settings/keys

### 2. Add the chat route to `server.js`

Copy everything from `chat_route.js` and paste it into `server.js` just **before** the final `server.listen(PORT, ...)` line.

Also add `const Anthropic = require('@anthropic-ai/sdk');` near the top with the other `require` statements (the route file already includes this, so just make sure it's not duplicated).

### 3. Install the new dependency

```bash
npm install
# or just: npm install @anthropic-ai/sdk
```

### 4. Restart the server

```bash
./claude2t stop
./claude2t start-daemon
```

---

## Usage

### Via curl

```bash
curl -X POST https://YOUR_SERVER/api/chat \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What packages do I have installed in Termux?",
    "client_id": "termux-main"
  }'
```

Response:
```json
{
  "response": "You have 47 packages installed. Key ones include python (3.11.4), git (2.43), curl, and openssh...",
  "history": [...]
}
```

### Multi-turn conversation

Pass the `history` array from the previous response back in your next request:

```bash
curl -X POST https://YOUR_SERVER/api/chat \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Now install the requests library",
    "client_id": "termux-main",
    "history": [... paste history from last response ...]
  }'
```

---

## Android HTTP Shortcut setup

Use the **HTTP Shortcuts** app to send messages to Claude from your home screen.

1. Create a new shortcut
   - Method: `POST`
   - URL: `https://YOUR_SERVER/api/chat`
   - Headers:
     ```
     Authorization: Bearer YOUR_ADMIN_TOKEN
     Content-Type: application/json
     ```
   - Body (tap "Show Text Input Dialog" for the message):
     ```json
     {
       "message": "{message}",
       "client_id": "termux-main"
     }
     ```
   - Add a **Text Input Dialog** variable named `message` with prompt "Ask Claude:"

2. In the response handling, display `$.response` from the JSON result.

Now one tap → type a message → Claude reasons and runs real commands on your phone.

---

## What Claude can do with this

- **Fix broken commands**: "My pip install is failing, fix it" → Claude runs it, reads the error, diagnoses, applies the fix
- **File management**: "Organize my Downloads folder by file type" → Claude lists files, creates dirs, moves them
- **System info**: "What's using the most storage?" → Claude runs `du`, interprets output
- **Scripting**: "Write and run a script to back up my config files to /sdcard/backup"
- **Debugging**: "Why is my Python script failing?" → Claude reads it, runs it, sees the error, suggests a fix

---

## Security notes

- The `/api/chat` endpoint uses the same `ADMIN_TOKEN` as `/api/exec` — keep it secret
- Claude is instructed to run commands step-by-step and show its reasoning
- Each tool call goes through the same HMAC-verified queue as manual commands
- Add `client_id` whitelisting in `.env` if you want to restrict which devices the chat agent can target
