# 配置参考

[文档首页](README.md) · [安装指南](installation.md)

插件配置位于 `plugins.entries.openclaw-telegram-ux`。可直接参考[默认账号示例](../examples/openclaw.default.json)和[命名账号示例](../examples/openclaw.named-account.json)，将片段合并到现有配置。

## 必填配置

| 字段 | 填写方式 |
| --- | --- |
| `config.allowedChatIds` | 已授权私聊的数字 ID 字符串数组，例如将 `YOUR_PRIVATE_CHAT_ID` 替换为原生 `/whoami` 返回的 ID |
| `config.expectedBotUsername` | 目标机器人用户名，不带 `@`；启动时会核实身份 |
| `hooks.allowConversationAccess` | 设为 `true`，允许宿主向插件提供所需消息及任务事件 |

插件只处理白名单中的私聊。此白名单不能授予宿主尚未批准的用户访问权限。

## 可选配置

| `config` 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `accountId` | `default` | 选择一个现有 Telegram 账号 |
| `language` | `zh` | 初始界面语言：`zh` 或 `en` |
| `progressStyle` | `detailed` | 初始显示方式：`compact` 或 `detailed` |
| `editIntervalMs` | `1500` | 同一聊天更新的最小间隔，单位毫秒，最低 `1000` |
| `statusTimeoutMs` | `1800000` | 无新任务事件达到此时长后结束进度跟踪，最低 `60000`；不会取消原生任务 |
| `mode` | `active` | 正常使用选择 `active`；`probe` 为维护者诊断模式 |

通过 `/tgux` 命令或菜单保存的聊天偏好优先于 `language`、`progressStyle` 的配置默认值。修改已有聊天的显示方式时，直接使用设置命令。

## Telegram 账号

默认账号从 `channels.telegram` 读取；命名账号从 `channels.telegram.accounts.<accountId>` 读取。

例如选择已有的 `work` 账号：

```json
{
  "accountId": "work",
  "allowedChatIds": ["YOUR_PRIVATE_CHAT_ID"],
  "expectedBotUsername": "YOUR_BOT_USERNAME",
  "language": "zh",
  "progressStyle": "detailed"
}
```

同时把 `channels.telegram.accounts.work.streaming.mode` 设为 `off`。账号级配置只作用于该机器人。命名账号有配置和隔离测试，当前正式实机验证仍限于默认账号，详见[兼容性](compatibility.md)。

## 凭据与权限

机器人凭据由现有 OpenClaw Telegram 账号提供，插件配置不另设 Token 字段。当前实现要求宿主运行时的 `botToken` 已解析为非空字符串。

插件不会自行读取 `tokenFile`、环境变量或解析 `SecretRef`。如果部署使用这些来源，需要确认宿主传入的运行时账号已包含该字符串；否则插件会以 `tgux_bot_token_unavailable` 拒绝启动。

`allowConversationAccess` 用于读取消息路由、识别命令和关联任务。进度说明来自当前模型的公开工具调用，普通观察回调只排队更新消息。插件使用已有 Telegram 接收流程，不启动新的 polling 或 webhook。

## 保存内容

在 OpenClaw 状态目录下的 `telegram-ux/` 保存：

| 文件 | 内容 |
| --- | --- |
| `state.json` | 路由标识、自有消息 ID、阶段和必要时间戳 |
| `preferences.json` | 每个已配置聊天的语言与显示偏好 |
| `events.jsonl`、`events.previous.jsonl` | 脱敏前的运行元数据；单份约 1 MiB 后轮转 |

插件不把聊天正文、工具参数、工具结果或凭据写入这些文件。具体工作说明仅暂存在内存和发送到 Telegram 的状态气泡中。元数据仍包含真实聊天与任务标识，分享报告前应做脱敏；宿主自己的会话记录由 OpenClaw 管理。
