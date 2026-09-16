# 问题排查

[文档首页](README.md) · [配置参考](configuration.md) · [维护与回滚](maintenance.md)

先区分原生机器人回复和插件状态：机器人能回答但没有进度时，检查插件；机器人本身也不能回复时，先检查 OpenClaw 与 Telegram 通道。

## 没有回执，或 /tgux 没有就绪

1. 检查 `openclaw --version` 是否为 `2026.9.1`。
2. 执行 `openclaw config validate`，确认插件已启用且重启完成。
3. 核对私聊 ID、机器人用户名和 `accountId`；用户名不带 `@`。
4. 确认目标私聊在 OpenClaw 中已获授权，并配置了 `hooks.allowConversationAccess: true`。
5. 检查宿主健康及插件日志中的固定错误码。

```sh
openclaw health --json
```

| 错误码 | 检查方向 |
| --- | --- |
| `tgux_unsupported_openclaw_version` | 安装与兼容矩阵匹配的宿主版本 |
| `tgux_invalid_chat_allowlist` | 使用非空的数字 ID 字符串数组，替换示例占位符 |
| `tgux_invalid_bot_username` | 仅填写用户名，去掉 `@` |
| `tgux_bot_token_unavailable` | 选中账号的运行时 `botToken` 没有解析为字符串 |
| `tgux_bot_identity_mismatch` | 配置的用户名与该凭据所属机器人不一致 |
| `tgux_preferences_unavailable` | 偏好文件格式或目录读取失败 |
| `tgux_state_unavailable` | 状态文件无法读取；先备份，再检查权限和内容 |

## 出现两套进度

检查目标账号的 `streaming.mode` 是否为 `off`。默认账号在 `channels.telegram`；命名账号在 `channels.telegram.accounts.<accountId>`。修改后按原有方式重启 Gateway。

## 只有阶段提示，没有具体工作说明

这是允许的正常情况。具体描述来自模型对 `tgux_progress` 的可选调用，简洁模式也会隐藏它。可先用 `/tgux style detailed` 检查显示方式。

没有新事件时显示等待提示，不代表插件在伪造新的工作步骤。任务真实状态以 OpenClaw 的回复或 `/status` 为准。

## 气泡没有删除

- 失败、停止、重启和跟踪超时的说明会保留。
- 附件路径可能在成功结束后多保留 5–10 秒。
- 限频或连接问题会使状态更新延迟。
- 创建消息的结果不确定时，插件不会盲目重发；若没有拿到消息 ID，就无法自动找到并清理该气泡，可手动删除。

## 菜单按钮不可用

打开新的 `/tgux` 菜单重试。菜单会过期，重启前的菜单和旧任务续问会失效；宿主配置禁用 inline buttons 时也不会显示按钮。

按钮仍属待补实机验收功能。语言、显示与帮助可使用[已实测的文字命令](usage.md#设置与帮助)。

## 提交问题

通过 [Bug report](https://github.com/pler1y/openclaw-telegram-ux/issues/new?template=bug_report.yml) 提供插件版本、OpenClaw 版本、系统、复现步骤以及固定错误码。截图和日志先移除 Token、真实聊天 ID、私人消息及配置内容。

开发者复现方法见[贡献指南](../CONTRIBUTING.md)。
