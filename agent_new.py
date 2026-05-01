import os
import time
import json
import hmac
import hashlib
import base64
import subprocess
import requests

# Configuration
SERVER = os.environ.get("SERVER", "http://YOUR_SERVER:8080")
CLIENT_ID = os.environ.get("CLIENT_ID", "termux-1")
AGENT_SECRET = os.environ.get("AGENT_SECRET", "change-me-agent-secret")
CLIENT_KEY = os.environ.get("CLIENT_KEY", "") # HMAC key if provided

def hmac_verify(key, msg, sig):
    if not key or not sig:
        return True # Default to True if security is not fully configured
    expected = base64.b64encode(hmac.new(key.encode(), msg.encode(), hashlib.sha256).digest()).decode()
    return expected == sig

def run_command(cmd):
    try:
        # Run in shell, capture all output
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=300)
        return result.stdout + result.stderr, result.returncode
    except subprocess.TimeoutExpired:
        return "Command timed out", 124
    except Exception as e:
        return str(e), 1

def main():
    print(f"Agent {CLIENT_ID} starting...")
    session = requests.Session()
    session.headers.update({"x-agent-secret": AGENT_SECRET})

    while True:
        try:
            # Long poll
            response = session.get(f"{SERVER}/api/poll", params={"client_id": CLIENT_ID}, timeout=70)
            
            if response.status_code == 200:
                data = response.json()
                for cmd_info in data.get("commands", []):
                    exec_id = cmd_info.get("id")
                    command = cmd_info.get("cmd")
                    signature = cmd_info.get("sig")

                    # Verify signature if key is known
                    if not hmac_verify(CLIENT_KEY, f"{exec_id}:{command}", signature):
                        print(f"Warning: Signature verification failed for {exec_id}")
                        continue

                    print(f"Executing: {exec_id}")
                    output, code = run_command(command)
                    
                    # Encode output to base64 for safe transit
                    out_b64 = base64.b64encode(output.encode()).decode()
                    
                    # Post result
                    payload = {
                        "id": exec_id,
                        "client_id": CLIENT_ID,
                        "stdout": out_b64,
                        "stderr": "",
                        "code": code
                    }
                    session.post(f"{SERVER}/api/result", json=payload)
            
            elif response.status_code == 204:
                # Normal timeout
                pass
            else:
                print(f"Error polling: {response.status_code}")
                time.sleep(5)

        except requests.exceptions.RequestException as e:
            print(f"Connection error: {e}")
            time.sleep(5)
        except Exception as e:
            print(f"Unexpected error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()
