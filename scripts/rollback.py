#!/usr/bin/env python3
"""Run on the OpenClaw server; restore only Telegram progress and disable this plugin."""
import argparse
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--backup", required=True, type=Path)
parser.add_argument("--config", type=Path, default=Path.home() / ".openclaw/openclaw.json")
parser.add_argument("--restore-plugin-config", action="store_true", help="Restore the backed-up plugin settings before reinstalling the baseline package")
args = parser.parse_args()
before = json.loads(args.backup.read_text())
current = json.loads(args.config.read_text())
entries = current.setdefault("plugins", {}).setdefault("entries", {})
entry = entries.setdefault("openclaw-telegram-ux", {})
account = entry.get("config", {}).get("accountId", "default")
if args.restore_plugin_config:
    entries["openclaw-telegram-ux"] = before["plugins"]["entries"]["openclaw-telegram-ux"]
else:
    entry["enabled"] = False
telegram = current["channels"]["telegram"] if account == "default" else current["channels"]["telegram"]["accounts"][account]
old_telegram = before["channels"]["telegram"] if account == "default" else before["channels"]["telegram"]["accounts"][account]
if "streaming" in old_telegram:
    telegram["streaming"] = old_telegram["streaming"]
else:
    telegram.pop("streaming", None)
temp = args.config.with_suffix(".tgux-rollback-tmp")
temp.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n")
os.chmod(temp, 0o600)
temp.replace(args.config)
print("已恢复基线插件配置，请重新安装基线软件包。" if args.restore_plugin_config else "Telegram UX 已禁用，原生 Telegram 进度设置已恢复。")
print("请执行：systemctl --user restart openclaw-gateway.service")
