# 更新日志 / Changelog

## [0.2.0-beta.2](https://github.com/pler1y/openclaw-telegram-ux/releases/tag/v0.2.0-beta.2) — 2026-09-20

- 整理中英文首页、安装与配置示例、用户文档、贡献指南和版本验证记录。
- 按任务核心、OpenClaw、Telegram 和存储职责组织源码；运行逻辑不变。
- 增加文档检查和干净构建，补充配置示例的安装验证。
- Add bilingual project documentation, contribution templates, module directories, and documentation/build checks.

## [0.2.0-beta.1](https://github.com/pler1y/openclaw-telegram-ux/releases/tag/v0.2.0-beta.1) — 2026-09-16

- 增加公开 `tgux_progress` 工具，由当前模型提供简短工作说明。
- 增加中英文界面、简洁/详细模式、经过时间和长等待提示。
- 扩展 `/tgux` 状态与设置，并实现公开菜单交互适配。
- 增加公开压缩与子任务事件适配；已测模型路径尚未触发相关展示。
- 87 项自动化与 20 个核心实机场景通过。按钮点击与续问尚待实机补验。
- Add task activity updates, bilingual display preferences, elapsed/waiting indicators, and public menu/event adapters. See the [validation record](docs/releases/0.2.0-beta.1-validation.md) for tested scope.

## [0.1.0-beta.1](https://github.com/pler1y/openclaw-telegram-ux/releases/tag/v0.1.0-beta.1) — 2026-09-16

- 首个公开核心版：即时回执、同气泡阶段、补充收件和原生停止终态。
- 支持成功清理、最小状态持久化、重启收尾和 Telegram 限频处理。
- 49 项自动化与 20 个核心实机场景通过，精确适配 OpenClaw 2026.9.1。
- Initial core release with task receipts, event-based progress, terminal cleanup, and restart recovery.
