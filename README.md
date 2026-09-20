# OpenClaw Telegram UX

**让 Telegram 里的长任务有回执、有进度、有明确的结束状态。**

中文 · [English](README.en.md)

[![CI](https://github.com/pler1y/openclaw-telegram-ux/actions/workflows/check.yml/badge.svg)](https://github.com/pler1y/openclaw-telegram-ux/actions/workflows/check.yml)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.9.1-blue)](docs/compatibility.md)
[![MIT License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

OpenClaw Telegram UX 是一个社区插件，在 Telegram 私聊中提供即时回执和持续更新的任务状态。进度集中在同一个气泡里，完成后自动收起，答案和附件照常由 OpenClaw 发送。

[下载 Beta 安装包](https://github.com/pler1y/openclaw-telegram-ux/releases/tag/v0.2.0-beta.2) · [快速开始](#快速开始) · [文档导航](docs/README.md) · [问题反馈](https://github.com/pler1y/openclaw-telegram-ux/issues)

**当前版本：0.2.0-beta.2，适配 OpenClaw 2026.9.1。** 已有可正常回复的 Telegram 机器人后，按下方步骤安装。

使用 **OpenClaw** 请选择本项目；使用 **Hermes Agent** 请前往 [Hermes Telegram UX](https://github.com/pler1y/hermes-telegram-ux)。两个插件分别安装，具体能力见[项目对照](docs/hermes-comparison.md)。

## 使用体验

发出请求后，状态气泡会随着实际工作更新。详细模式的显示示例：

```text
正在搜索资料…
正在核对三个来源
已用时 30 秒
```

- **及时确认**：收到普通消息后显示回执；运行中追加要求会确认“补充已收到”。
- **持续更新**：展示思考、搜索、工具执行和整理阶段；模型可提供简短的具体工作说明。
- **按需显示**：支持中文与英文、简洁与详细模式。详细模式提供计时和长时间等待提示。
- **明确收尾**：成功后清理状态气泡；取消、失败或重启后保留简短说明。
- **原生交付**：保留 OpenClaw 的最终答案、Markdown、引用、附件和停止行为。

插件通过公开 SDK 与 Telegram Bot API 工作，可独立安装，无需修改 OpenClaw 核心。

## 快速开始

当前发布为 **0.2.0-beta.2**。需要 **OpenClaw 2026.9.1**、**Node.js ≥ 24.16.0**，以及已经能正常回复的 Telegram 机器人和已授权私聊。其他 OpenClaw 版本暂未支持。

### 1. 下载并安装

从 [Release](https://github.com/pler1y/openclaw-telegram-ux/releases/tag/v0.2.0-beta.2) 下载 `openclaw-telegram-ux-0.2.0-beta.2.tgz` 和 `SHA256SUMS`。在机器人空闲时备份当前配置，核对校验值后安装：

```sh
openclaw plugins install npm-pack:./openclaw-telegram-ux-0.2.0-beta.2.tgz --accept-capabilities
```

### 2. 配置自己的私聊

将下面的片段合并到现有 OpenClaw 配置，保留已有字段。替换两个占位符：私聊 ID 是数字字符串，可通过原生 `/whoami` 查询；机器人用户名不带 `@`。

```json
{
  "channels": {
    "telegram": {
      "streaming": { "mode": "off" }
    }
  },
  "plugins": {
    "entries": {
      "openclaw-telegram-ux": {
        "enabled": false,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "allowedChatIds": ["YOUR_PRIVATE_CHAT_ID"],
          "expectedBotUsername": "YOUR_BOT_USERNAME"
        }
      }
    }
  }
}
```

这个示例使用默认 Telegram 账号。插件复用宿主的机器人凭据；[配置说明](docs/configuration.md)包含命名账号、凭据读取要求和全部可选项。

### 3. 启用并检查

```sh
openclaw plugins enable openclaw-telegram-ux
openclaw config validate
openclaw gateway restart
```

在目标私聊中发送 `/tgux`，应看到“已启用”，再发一条普通消息。使用 Docker 或其他进程管理器时，按原有方式重启服务。

完整流程、校验方式和升级步骤见[安装指南](docs/installation.md)。

## 常用操作

| 想做什么 | 发送 |
| --- | --- |
| 查看状态 | `/tgux` |
| 查看帮助 | `/tgux help` |
| 切换界面语言 | `/tgux lang zh` 或 `/tgux lang en` |
| 切换显示方式 | `/tgux style compact` 或 `/tgux style detailed` |
| 停止当前任务 | 原生 `/stop`，或整条消息“停止”“停下来”“暂停” |

界面语言不改变最终答案语言。“暂停”沿用原生取消行为，不会保存可恢复的任务。更多说明见[使用指南](docs/usage.md)。

## Beta 范围

当前实机验证范围是 OpenClaw 2026.9.1、xai/grok-4.6 和一个已授权私聊。

菜单显示和设置命令已实测，按钮点击与续问仍待实机补验。压缩和后台任务的展示适配已有自动化覆盖，但已测模型路径尚未触发相应公开事件。具体工作说明由模型决定是否提供，未调用进度工具时继续显示真实阶段。

[兼容性与限制](docs/compatibility.md) · [版本验证记录](docs/releases/0.2.0-beta.2-validation.md)

## 文档与目录导航

- [安装与升级](docs/installation.md)、[配置参考](docs/configuration.md)、[使用指南](docs/usage.md)：完成配置并使用日常操作。
- [问题排查](docs/troubleshooting.md)、[维护与回滚](docs/maintenance.md)：处理运行问题、禁用或移除插件。
- [源码目录与事件流](docs/development/architecture.md)、[完整文档索引](docs/README.md)：了解模块职责及版本记录。

## 参与开发

从 [贡献指南](CONTRIBUTING.md)开始。源码分为任务核心、OpenClaw 适配、Telegram 展示与交互、状态存储四部分；[架构说明](docs/development/architecture.md)介绍各模块和事件流。

项目使用 [MIT License](LICENSE)，是独立维护的社区项目。当前通过 GitHub Releases 分发，ClawHub 状态见[发布记录](docs/releases/0.2.0-beta.1-publishing.md)。
