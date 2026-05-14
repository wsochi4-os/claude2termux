#!/usr/bin/env bash
# Termux polling agent using curl and openssl for HMAC verification.
# Requires: curl, coreutils, openssl, jq (optional but recommended)

SERVER=${SERVER:-"http://YOUR_SERVER:8080"}
CLIENT_ID=${CLIENT_ID:-"termux-1"}
AGENT_SECRET=${AGENT_SECRET:-"change-me-agent-secret"}
CLIENT_KEY=${CLIENT_KEY:-""}
TIMEOUT_VAL=${TIMEOUT_VAL:-60}

if [ -z "$CLIENT_KEY" ]; then
  echo "CLIENT_KEY is required for HMAC verification. Set CLIENT_KEY env var." >&2
  exit 1
fi

# Check for 'timeout' utility
if ! command -v timeout >/dev/null 2>&1; then
  echo "Warning: 'timeout' utility not found. Timeouts will be disabled." >&2
  HAS_TIMEOUT=false
else
  HAS_TIMEOUT=true
fi

# Check for 'jq' utility
if command -v jq >/dev/null 2>&1; then
  HAS_JQ=true
else
  HAS_JQ=false
  echo "Warning: 'jq' not found. Falling back to fragile parsing." >&2
fi

# Constant-time comparison function
constant_time_compare() {
  local a="$1"
  local b="$2"
  if [ "${#a}" -ne "${#b}" ]; then
    return 1
  fi
  local res=0
  for (( i=0; i<${#a}; i++ )); do
    local char_a=$(printf '%d' "'${a:$i:1}")
    local char_b=$(printf '%d' "'${b:$i:1}")
    res=$(( res | (char_a ^ char_b) ))
  done
  return $res
}

while true; do
  RESP=$(curl -sS -m 70 -H "x-agent-secret: $AGENT_SECRET" "$SERVER/api/poll?client_id=$CLIENT_ID") || true
  if [ -z "$RESP" ]; then sleep 1; continue; fi
  
  if [ "$HAS_JQ" = true ]; then
    COMMANDS=$(echo "$RESP" | jq -c '.commands[]?' 2>/dev/null)
  else
    # Fallback parsing
    COMMANDS=$(echo "$RESP" | tr '}' '\n' | grep '"id":')
  fi

  if [ -z "$COMMANDS" ]; then sleep 1; continue; fi

  echo "$COMMANDS" | while read -r line; do
    if [ "$HAS_JQ" = true ]; then
      ID=$(echo "$line" | jq -r '.id')
      CMD=$(echo "$line" | jq -r '.cmd')
      SIG=$(echo "$line" | jq -r '.sig')
    else
      ID=$(echo "$line" | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p')
      CMD=$(echo "$line" | sed -n 's/.*"cmd" *: *"\([^"]*\)".*/\1/p' | sed 's/\\n/\n/g' | sed 's/\\"/"/g')
      SIG=$(echo "$line" | sed -n 's/.*"sig" *: *"\([^"]*\)".*/\1/p')
    fi
    
    if [ -z "$ID" ] || [ -z "$CMD" ]; then continue; fi

    # Verify HMAC
    EXPECTED=$(printf '%s:%s' "$ID" "$CMD" | openssl dgst -sha256 -hmac "$CLIENT_KEY" -binary | openssl base64 -A)
    
    if [ -n "$SIG" ]; then
      if ! constant_time_compare "$SIG" "$EXPECTED"; then
        echo "Signature mismatch for id $ID; skipping" >&2
        continue
      fi
    fi

    echo "Executing command $ID: $CMD"
    
    if [ "$HAS_TIMEOUT" = true ]; then
      OUT=$(timeout "$TIMEOUT_VAL" sh -c "$CMD" 2>&1)
      RC=$?
      if [ $RC -eq 124 ]; then
        OUT="Execution Timed Out\n$OUT"
      fi
    else
      OUT=$(sh -c "$CMD" 2>&1)
      RC=$?
    fi

    # Encode output to base64 for safe transport
    B64_OUT=$(printf '%s' "$OUT" | openssl base64 -A)
    
    # Construct JSON payload safely
    if [ "$HAS_JQ" = true ]; then
      PAYLOAD=$(jq -n \
        --arg id "$ID" \
        --arg client_id "$CLIENT_ID" \
        --arg stdout "$B64_OUT" \
        --arg stderr "" \
        --argjson code "$RC" \
        '{id: $id, client_id: $client_id, stdout: $stdout, stderr: $stderr, code: $code}')
    else
      # Manual escaping for fallback
      ESCAPED_ID=$(printf '%s' "$ID" | sed 's/"/\\"/g')
      ESCAPED_CLIENT_ID=$(printf '%s' "$CLIENT_ID" | sed 's/"/\\"/g')
      PAYLOAD=$(printf '{"id":"%s","client_id":"%s","stdout":"%s","stderr":"","code":%d}' "$ESCAPED_ID" "$ESCAPED_CLIENT_ID" "$B64_OUT" "$RC")
    fi
    
    curl -sS -m 10 -H "Content-Type: application/json" -H "x-agent-secret: $AGENT_SECRET" -d "$PAYLOAD" "$SERVER/api/result" >/dev/null || true
  done
  sleep 1
done
