#!/usr/bin/env python3
"""Run on the test server. Export metadata only, replacing route/run identifiers."""
import datetime
import argparse
import json
from pathlib import Path

directory = Path.home() / ".openclaw/telegram-ux"
parser = argparse.ArgumentParser()
parser.add_argument("--since", type=int, default=0, help="Minimum event timestamp in milliseconds")
args = parser.parse_args()
events = []
for name in ["events.previous.jsonl", "events.jsonl"]:
    path = directory / name
    if not path.exists():
        continue
    for line in path.read_text().splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
start = next((i for i, e in enumerate(events) if e.get("event") == "ready"), len(events))
maps = {key: {} for key in ["chatId", "sessionKey", "runId", "inboundId", "messageId", "threadId"]}
allowed = {"ready", "received", "created", "run_bound", "thinking", "tool_start", "tool_end", "organizing", "approval", "supplement", "supplement_received", "finish", "native_delivery", "delivered", "close_success", "deleted", "edited", "cancel", "orphan", "timeout", "transport_error", "ambiguous_inbound_skipped"}
for e in events[start:]:
    allowed.update({"progress", "compaction", "child_start", "child_end", "menu_created", "menu_updated", "menu_update_failed", "callback_rejected", "followup_submitted"})
    if e.get("event") not in allowed or e["at"] < args.since:
        continue
    result = {"at": datetime.datetime.fromtimestamp(e["at"] / 1000, datetime.timezone.utc).isoformat(timespec="milliseconds"), "event": e["event"]}
    for key in ["phase", "success", "kind"]:
        if key in e:
            result[key] = e[key]
    for key, mapping in maps.items():
        if key in e:
            mapping.setdefault(e[key], f"{key.removesuffix('Id').removesuffix('Key')}-{len(mapping) + 1:03}")
            result[key] = mapping[e[key]]
    if "accountId" in e:
        result["accountId"] = "test-account"
    print(json.dumps(result, ensure_ascii=False))
