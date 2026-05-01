#!/usr/bin/env bash
# Termux polling agent using curl and openssl for HMAC verification.
# Requires: curl, coreutils, openssl

SERVER=${SERVER:-"http://YOUR_SERVER:8080"}
CLIENT_ID=${CLIENT_ID:-"termux-1"}
AGENT_SECRET=${AGENT_SECRET:-"change-me-agent-secret"}
CLIENT_KEY=${CLIENT_KEY:-""}

if [ -z "$CLIENT_KEY" ]; then
  echo "CLIENT_KEY is required for HMAC verification. Set CLIENT_KEY env var." >&2
  exit 1
fi

while true; do
  RESP=$(curl -sS -m 70 -H "x-agent-secret: $AGENT_SECRET" "$SERVER/api/poll?client_id=$CLIENT_ID") || true
  if [ -z "$RESP" ]; then sleep 1; continue; fi
  echo "$RESP" | grep -q 'commands' || { sleep 1; continue; }
  echo "$RESP" | tr '{' '\n' | while read -r line; do
    echo "$line" | grep -q '"id":' || continue
    ID=$(echo "$line" | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p')
    CMD=$(echo "$line" | sed -n 's/.*"cmd" *: *"\([^"]*\)".*/\1/p' | sed 's/\\n/\n/g' | sed 's/\\"/"/g')
    SIG=$(echo "$line" | sed -n 's/.*"sig" *: *"\([^\"]*\)".*/\1/p')
    if [ -z "$ID" ] || [ -z "$CMD" ]; then
      continue
    fi
    # verify HMAC
    EXPECTED=$(printf '%s:%s' "$ID" "$CMD" | openssl dgst -sha256 -hmac "$CLIENT_KEY" -binary | openssl base64 -A)
    if [ -n "$SIG" ] && [ "$SIG" != "$EXPECTED" ]; then
      echo "Signature mismatch for id $ID; skipping" >&2
      continue
    fi
    OUT=$(sh -c "$CMD" 2>&1)
    RC=$?
    PAYLOAD=$(printf '{"id":"%s","client_id":"%s","stdout":"%s","stderr":"","code":%d}' "$ID" "$CLIENT_ID" "$(printf '%s' "$OUT" | openssl base64 -A)" "$RC")
    curl -sS -m 10 -H "Content-Type: application/json" -H "x-agent-secret: $AGENT_SECRET" -d "$PAYLOAD" "$SERVER/api/result" >/dev/null || true
  done
  sleep 1
done
