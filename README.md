# OpenClaw Telegram UX

为 Telegram 私聊提供中文即时回执、思考与工具进度、补充收件提示和停止说明。状态在插件自己的气泡里更新；最终答案、Markdown、引用和附件由 OpenClaw 原生发送。

当前版本：`0.1.0-beta.1`。精确适配 **OpenClaw 2026.9.1**，Node.js ≥ 24.16.0。其他 OpenClaw 版本会拒绝加载，升级前需要重新完成契约与实机验证。

指定私聊的 20 个实机验收场景已通过，当前部署保持启用。完整验证范围见 [测试报告](docs/TEST-REPORT.md)。

## 使用

正常向机器人发消息即可。运行中补充消息会显示“补充已收到”，不承诺已经被模型采纳。`/stop` 保留原生停止行为；`/tgux` 查看功能与状态。

任务成功后状态气泡自动清理。文本路径优先等待发送确认；原生附件路径可能没有发送确认，明确成功结束的任务会在 5–10 秒内清理状态。失败、取消或服务重启保留简短说明。跟踪超时只结束进度展示，不取消原生任务。

## 开发与验证

```sh
npm ci --ignore-scripts
npm run check
mkdir -p artifacts
npm pack --pack-destination artifacts
node scripts/install-check.mjs
```

`src/state.ts` 是框架无关状态机；`src/adapter.ts` 仅适配公开 OpenClaw 事件；`src/telegram.ts` 使用官方 Bot API。`src/controller.ts` 负责路由、持久化与消息所有权，`src/outbox.ts` 合并并串行执行同聊天的更新。

## 安装

先备份 OpenClaw 配置，并在机器人空闲时操作。

```sh
openclaw plugins install ./openclaw-telegram-ux-0.1.0-beta.1.tgz --force --accept-capabilities
```

安装后按实际私聊 ID 配置：

```json
{
  "plugins": {
    "entries": {
      "openclaw-telegram-ux": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "mode": "active",
          "accountId": "default",
          "allowedChatIds": ["YOUR_PRIVATE_CHAT_ID"],
          "expectedBotUsername": "YOUR_BOT_USERNAME",
          "editIntervalMs": 1500,
          "statusTimeoutMs": 1800000
        }
      }
    }
  }
}
```

正式启用时将目标 Telegram 账号的 `streaming.mode` 改为 `off`，再重启 Gateway。只改该账号的进度设置；保持模型、凭据、原生队列和工具配置。

插件复用 `channels.telegram.botToken`（或指定账号的 `botToken`），仅在进程内使用。当前适配要求此字段在运行时是已解析的字符串；无法读取时拒绝启动。不会启用第二个 polling 或 webhook。

## 状态与恢复

数据在 OpenClaw 状态目录下的 `telegram-ux/`。`state.json` 只存路由、消息 ID、状态与时间；日志不存聊天正文、工具参数、工具结果或凭据。日志最多保留当前与上一份各约 1 MiB 的事件记录。

发送结果不确定时不重发，以免重复气泡；缺少消息 ID 时无法自动找到或清理该消息，可手动删除。状态传输异常不会阻止原生回复。缺少明确事件关联时跳过更新。

见 [接口证据](docs/PUBLIC-API.md)、[兼容范围](docs/COMPATIBILITY.md)、[测试报告](docs/TEST-REPORT.md) 和 [部署与回滚](docs/DEPLOYMENT.md)。
