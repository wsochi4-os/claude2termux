#!/usr/bin/env python3
# Termux agent: connects out to controller and executes received commands
import asyncio
import os
import json
import sys
from websockets import connect

SERVER = os.environ.get('SERVER') or 'ws://YOUR_SERVER:8080'
CLIENT_ID = os.environ.get('CLIENT_ID') or 'termux-1'
SECRET = os.environ.get('AGENT_SECRET') or 'change-me-agent-secret'

async def run():
    uri = f"{SERVER}/?client_id={CLIENT_ID}&secret={SECRET}"
    async with connect(uri) as ws:
        print('connected to', uri)
        async for msg in ws:
            try:
                m = json.loads(msg)
            except:
                continue
            if m.get('type') == 'exec':
                exec_id = m.get('id')
                cmd = m.get('cmd')
                print('exec', exec_id, cmd)
                proc = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                while True:
                    out = await proc.stdout.read(4096)
                    if out:
                        await ws.send(json.dumps({'type':'output','id':exec_id,'stdout': out.decode(errors='ignore')}))
                    err = await proc.stderr.read(4096)
                    if err:
                        await ws.send(json.dumps({'type':'output','id':exec_id,'stderr': err.decode(errors='ignore')}))
                    if proc.stdout.at_eof() and proc.stderr.at_eof():
                        break
                rc = await proc.wait()
                await ws.send(json.dumps({'type':'exit','id':exec_id,'code': rc}))

if __name__ == '__main__':
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        sys.exit(0)
