#!/usr/bin/env python3
"""Run on the OpenClaw server; restore only Telegram progress and disable this plugin."""
import argparse
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--backup", required=True, type=Path)
parser.add_argument("--config", type=Path, default=Path.home() / ".openclaw/openclaw.json")
args = parser.parse_args()
before = json.loads(args.backup.read_text())
current = json.loads(args.config.read_text())
current.setdefault("plugins", {}).setdefault("entries", {}).setdefault("openclaw-telegram-ux", {})["enabled"] = False
telegram = current["channels"]["telegram"]
old_telegram = before["channels"]["telegram"]
if "streaming" in old_telegram:
    telegram["streaming"] = old_telegram["streaming"]
else:
    telegram.pop("streaming", None)
temp = args.config.with_suffix(".tgux-rollback-tmp")
temp.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n")
os.chmod(temp, 0o600)
temp.replace(args.config)
print("Telegram UX 已禁用，原生 Telegram 进度设置已恢复。")
print("请执行：systemctl --user restart openclaw-gateway.service")
