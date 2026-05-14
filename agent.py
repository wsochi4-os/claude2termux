#!/usr/bin/env python3
# Termux agent: connects out to controller and executes received commands
import asyncio
import os
import json
import sys
import hmac
import hashlib
import base64
from websockets import connect

SERVER = os.environ.get('SERVER') or 'ws://YOUR_SERVER:8080'
CLIENT_ID = os.environ.get('CLIENT_ID') or 'termux-1'
SECRET = os.environ.get('AGENT_SECRET') or 'change-me-agent-secret'
CLIENT_KEY = os.environ.get('CLIENT_KEY') or ''

def verify_hmac(key, msg, sig):
    if not key:
        return True # Skip if no key provided (legacy/insecure mode)
    expected = base64.b64encode(hmac.new(key.encode(), msg.encode(), hashlib.sha256).digest()).decode()
    return hmac.compare_digest(expected, sig)

async def run():
    uri = f"{SERVER}/?client_id={CLIENT_ID}&secret={SECRET}"
    backoff = 1
    while True:
        try:
            async with connect(uri) as ws:
                print('connected to', uri)
                backoff = 1 # Reset backoff on success
                async for msg in ws:
                    try:
                        m = json.loads(msg)
                    except:
                        continue
                    if m.get('type') == 'exec':
                        exec_id = m.get('id')
                        cmd = m.get('cmd')
                        sig = m.get('sig')
                        
                        # Verify HMAC
                        if CLIENT_KEY:
                            msg_to_sign = f"{exec_id}:{cmd}"
                            if not sig or not verify_hmac(CLIENT_KEY, msg_to_sign, sig):
                                print(f"Signature mismatch for id {exec_id}; skipping")
                                continue

                        print('exec', exec_id, cmd)
                        # Default timeout 60s if not specified
                        timeout = 60 
                        
                        try:
                            proc = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                            
                            async def read_stream(stream, stream_type):
                                try:
                                    while True:
                                        line = await stream.read(4096)
                                        if not line:
                                            break
                                        encoded = base64.b64encode(line).decode()
                                        await ws.send(json.dumps({'type':'output','id':exec_id, stream_type: encoded}))
                                except Exception as e:
                                    print(f"Stream read error: {e}")
                                finally:
                                    # Ensure we don't leave pipes hanging
                                    try:
                                        if hasattr(stream, 'close'):
                                            stream.close()
                                    except:
                                        pass

                            try:
                                # Wait for process with timeout
                                await asyncio.wait_for(asyncio.gather(
                                    read_stream(proc.stdout, 'stdout'),
                                    read_stream(proc.stderr, 'stderr'),
                                    proc.wait()
                                ), timeout=timeout)
                                rc = proc.returncode
                            except asyncio.TimeoutError:
                                print(f"Command {exec_id} timed out")
                                try:
                                    proc.terminate()
                                    await asyncio.sleep(0.5)
                                    if proc.returncode is None:
                                        proc.kill()
                                except:
                                    pass
                                rc = 124 # Standard timeout exit code
                                await ws.send(json.dumps({'type':'output','id':exec_id, 'stderr': base64.b64encode(b"Execution Timed Out\n").decode()}))
                            
                            await ws.send(json.dumps({'type':'exit','id':exec_id,'code': rc}))
                        except Exception as e:
                            print(f"Exec error: {e}")
                            await ws.send(json.dumps({'type':'exit','id':exec_id,'code': 1, 'stderr': base64.b64encode(str(e).encode()).decode()}))
        except Exception as e:
            print(f"Connection error: {e}. Retrying in {backoff}s...")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60) # Exponential backoff up to 60s

if __name__ == '__main__':
    if not CLIENT_KEY:
        print("Warning: CLIENT_KEY not set. HMAC verification disabled.", file=sys.stderr)
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
