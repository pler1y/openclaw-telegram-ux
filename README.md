# OpenClaw Telegram UX

为 Telegram 私聊提供即时回执、同气泡任务进度、中英文菜单和补充收件提示。详细模式显示实际工作说明、经过时间和长等待提示；最终答案、Markdown、引用和附件由 OpenClaw 原生发送。

当前版本：`0.2.0-beta.1`。精确适配 **OpenClaw 2026.9.1**，Node.js ≥ 24.16.0。其他 OpenClaw 版本会拒绝加载，升级前需要重新完成契约与实机验证。

基线 `v0.1.0-beta.1` 与增强版分别保存于 [GitHub Releases](https://github.com/pler1y/openclaw-telegram-ux/releases)。完整验证范围见 [测试报告](docs/TEST-REPORT.md)。

## 使用

正常向机器人发消息即可。运行中补充消息会显示“补充已收到”，不承诺已经被模型采纳。`/stop` 或整条消息“停止”“停下来”“暂停”沿用原生停止行为；`/tgux` 打开状态与设置菜单。

| 操作 | 方法 |
| --- | --- |
| 界面语言 | 菜单 中文 / English；或 `/tgux lang zh`、`/tgux lang en` |
| 显示方式 | 菜单 简洁 / 详细；或 `/tgux style compact`、`/tgux style detailed` |
| 继续当前话题 | 最近任务完成后打开 `/tgux`，点击“继续解释”或“简要总结” |
| 帮助 | `/tgux help` |

菜单有效期十分钟，服务重启或打开新菜单后旧菜单失效。续问只适用于打开菜单时的最近任务；出现新任务后旧续问按钮不再提交。没有任务绑定的停止按钮。界面设置不改变最终答案语言。

当前模型可以通过公开工具 `tgux_progress` 提供一句工作说明，例如“正在核对三个来源”；未调用时继续显示真实事件驱动的阶段。进度说明不是内部思考、最终答案或完成保证，不生成百分比。

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
openclaw plugins install npm-pack:./openclaw-telegram-ux-0.2.0-beta.1.tgz --force --accept-capabilities
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
          "statusTimeoutMs": 1800000,
          "language": "zh",
          "progressStyle": "detailed"
        }
      }
    }
  }
}
```

正式启用时将目标 Telegram 账号的 `streaming.mode` 改为 `off`，再重启 Gateway。只改该账号的进度设置；保持模型、凭据、原生队列和工具配置。

插件复用 `channels.telegram.botToken`（或指定账号的 `botToken`），仅在进程内使用。当前适配要求此字段在运行时是已解析的字符串；无法读取时拒绝启动。不会启用第二个 polling 或 webhook。

## 状态与恢复

数据在 OpenClaw 状态目录下的 `telegram-ux/`。`state.json` 只存路由、消息 ID、状态与时间；`preferences.json` 只保存本插件的语言和显示偏好。日志不存聊天正文、工具参数、工具结果或凭据。工作说明仅暂存在内存和插件拥有的 Telegram 气泡中，不写入插件状态或日志。日志最多保留当前与上一份各约 1 MiB 的事件记录。宿主自身的正常会话记录不由插件控制。

发送结果不确定时不重发，以免重复气泡；缺少消息 ID 时无法自动找到或清理该消息，可手动删除。状态传输异常不会阻止原生回复。缺少明确事件关联时跳过更新。

见 [接口证据](docs/PUBLIC-API.md)、[兼容范围](docs/COMPATIBILITY.md)、[测试报告](docs/TEST-REPORT.md) 和 [部署与回滚](docs/DEPLOYMENT.md)。
