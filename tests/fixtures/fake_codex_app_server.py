from __future__ import annotations

import json
import os
import sys
import time

mode = sys.argv[1] if len(sys.argv) > 1 else "normal"

for line in sys.stdin:
    message = json.loads(line)
    if "id" not in message:
        continue
    method = message["method"]
    params = message.get("params", {})
    if mode == "invalid-json":
        print("not-json", flush=True)
        continue
    if mode == "wrong-id":
        print(json.dumps({"jsonrpc": "2.0", "id": message["id"] + 1, "result": {}}), flush=True)
        continue
    if mode == "partial-timeout":
        sys.stdout.write("{")
        sys.stdout.flush()
        time.sleep(2)
        continue
    if mode == "notification" and method == "account/read":
        print(json.dumps({"jsonrpc": "2.0", "method": "warning", "params": {"message": "test"}}), flush=True)
    if method == "initialize":
        result = {
            "codexHome": "/tmp/fake-codex-home",
            "platformFamily": "unix",
            "platformOs": "test",
            "userAgent": "learnstepper/0.144.5 (Test OS; test) unknown (learnstepper; 0.1.0)",
        }
    elif method == "account/read":
        result = {"account": {"type": "chatgpt"}}
    elif method == "test/environment":
        result = {"value": os.environ.get("LEARNSTEPPER_SECRET_CANARY")}
    elif method == "test/cwd":
        result = {"value": os.getcwd()}
    elif method == "thread/start":
        result = {"thread": {"id": "remote-thread-started", "turns": []}}
    elif method == "thread/resume":
        result = {"thread": {"id": params["threadId"], "turns": []}}
    elif method == "turn/start":
        result = {"turn": {"id": "remote-turn-started", "items": [], "status": "inProgress"}}
    elif method in {"turn/interrupt", "thread/inject_items"}:
        result = {}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
    if mode == "notification-flood" and method == "account/read":
        for index in range(1_100):
            print(
                json.dumps({"jsonrpc": "2.0", "method": "warning", "params": {"index": index}}),
                flush=True,
            )
    if mode == "delayed-notification" and method == "account/read":
        time.sleep(0.02)
        print(json.dumps({"jsonrpc": "2.0", "method": "warning", "params": {"message": "late"}}), flush=True)
