Android HTTP Shortcut (example)

Use the 'HTTP Shortcuts' app (or similar) to create a one-tap command sender.

1) Create new shortcut
   - Method: POST
   - URL: https://YOUR_SERVER/api/exec
   - Headers:
       Authorization: Bearer YOUR_ADMIN_TOKEN
       Content-Type: application/json
   - Body (raw JSON):
       {"client_id":"termux-myphone","cmd":"ls -la /data/data"}

2) Save and run. The server will wait for the agent to return results. Use /api/send if you prefer enqueue-only.

Security: keep the token secret. Use HTTPS.
