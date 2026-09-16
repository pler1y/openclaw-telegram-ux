# 部署与回滚

要求已有正常工作的 OpenClaw 2026.9.1、Telegram 机器人和已授权私聊。插件复用现有入站，不新增 polling/webhook。

安装前等待当前任务结束，备份实际使用的 OpenClaw 配置，备份目录权限设为 700、文件权限设为 600。按 README 安装和配置插件，确认 `expectedBotUsername` 与现有 Bot 身份相符。

将目标账号的 `channels.telegram.streaming.mode` 改为 `off`，避免重复进度。其他模型、认证、记忆、工具、浏览器和消息队列设置保持不变。使用现有服务管理方式重启 Gateway。

## 服务器上的回滚命令

安装包包含回滚脚本。以下路径为示例，替换为实际状态目录和安装前备份：

```sh
python3 ~/.openclaw/extensions/openclaw-telegram-ux/scripts/rollback.py --backup /path/to/openclaw.json.before
systemctl --user restart openclaw-gateway.service
```

脚本只禁用插件并恢复相关原生进度设置，不覆盖后来对模型、记忆、工具或浏览器的更改。非 systemd 部署使用原有重启方式。完整备份保留用于人工恢复。

需要卸载时，在恢复原生进度并重启后执行：

```sh
openclaw plugins uninstall openclaw-telegram-ux --force
systemctl --user restart openclaw-gateway.service
```

OpenClaw 2026.9.1 的卸载会移除包目录，并可能保留 `enabled: false` 标记，防止同 ID 自动重新发现。插件的最小状态与事件记录保留在 `~/.openclaw/telegram-ux/`，可按维护需要归档。

## 检查

Telegram 私聊执行 `/tgux`。服务器执行：

```sh
openclaw health --json
systemctl --user is-active openclaw-gateway.service
```

不要公开配置备份、原始日志或凭据。公开测试报告仅包含场景和结论。
