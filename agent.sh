#!/usr/bin/env sh
# Simple Termux polling agent using curl and sh. Requires: curl, base64 (coreutils), jq (optional but not required)
# Usage: export SERVER="https://yourserver:8080" CLIENT_ID="termux-1" AGENT_SECRET="secret" && ./agent.sh

SERVER=${SERVER:-"http://YOUR_SERVER:8080"}
CLIENT_ID=${CLIENT_ID:-"termux-1"}
AGENT_SECRET=${AGENT_SECRET:-"change-me-agent-secret"}

while true; do
  # Long poll for up to ~60s (server holds 55s)
  RESP=$(curl -sS -m 70 -H "x-agent-secret: $AGENT_SECRET" "$SERVER/api/poll?client_id=$CLIENT_ID") || true
  STATUS=$?
  if [ -z "$RESP" ]; then
    # empty means 204 or timeout; retry immediately
    sleep 1
    continue
  fi
  # Parse commands (very small JSON parser using grep/awk) -- expecting {"commands":[{"id":"...","cmd":"..."},...]}
  echo "$RESP" | grep -q 'commands' || { sleep 1; continue; }
  # Extract all command blocks
  echo "$RESP" | tr '{' '\n' | while read -r line; do
    echo "$line" | grep -q '"id":' || continue
    ID=$(echo "$line" | sed -n 's/.*"id" *: *"\([0-9a-fA-F]*\)".*/\1/p')
    CMD=$(echo "$line" | sed -n 's/.*"cmd" *: *"\(.*\)".*/\1/p' | sed 's/\\n/\n/g' | sed 's/\\"/"/g')
    if [ -z "$ID" ] || [ -z "$CMD" ]; then
      continue
    fi
    # Run the command and capture stdout/stderr and exit code
    OUT=$(sh -c "$CMD" 2> >(cat >&2) 2>&1)
    RC=$?
    # Post result (base64 encode to be safe)
    # Use printf to avoid issues with binary
    PAYLOAD=$(printf '{"id":"%s","client_id":"%s","stdout":"%s","stderr":"","code":%d}' "$ID" "$CLIENT_ID" "$(printf '%s' "$OUT" | base64 -w0)" "$RC")
    curl -sS -m 10 -H "Content-Type: application/json" -H "x-agent-secret: $AGENT_SECRET" -d "$PAYLOAD" "$SERVER/api/result" >/dev/null || true
  done
  sleep 1
done
