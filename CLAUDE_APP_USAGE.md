# 📱 Using Claude Android App with Termux

To control your Termux directly from the Claude Android app, follow these steps to create a "Remote Console" Artifact.

### 1. Ensure your Server is Public
Your `server.js` needs to be accessible via HTTPS. 
- Use **Cloudflare Tunnel** (`cloudflared tunnel run ...`) 
- Or a **VPS** with a domain.

### 2. Use this Prompt in the Claude App
Copy and paste the following prompt into your conversation with Claude on Android:

> "I want to control my Termux terminal through you. Please create a React Artifact that acts as a 'Termux Dashboard'. 
> 
> It should have:
> 1. A configuration section for 'Server URL' and 'Admin Token'.
> 2. A command input bar.
> 3. A scrollable terminal output window.
> 4. Buttons for quick commands like 'ls', 'top', and 'pkg upgrade'.
> 
> The UI should be dark-themed (Cyberpunk/Termux style). When I send a command, it should POST to `{ServerURL}/api/exec` with the 'Authorization: Bearer {Token}' header."

### 3. The Result
Claude will generate a beautiful terminal UI right inside your chat. You can then:
- Type a command in the Claude app.
- The app (Artifact) sends it to your bridge server.
- Your Termux (Agent) executes it.
- The output flows back to your Claude app screen.

---

## 🔧 Developer Note: CORS
For this to work, your `server.js` must allow requests from the Claude sandbox. Ensure your `cors` configuration in `server.js` is set to:
```javascript
app.use(require('cors')({
  origin: '*', // Allows Claude Artifacts to connect
  methods: ['GET', 'POST']
}));
```
