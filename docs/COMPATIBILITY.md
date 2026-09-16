# 兼容范围

| 项目 | 当前支持 |
| --- | --- |
| OpenClaw | 仅 2026.9.1；其他版本拒绝注册 |
| 目标模型 | 实机沿用 xai/grok-4.6；插件不修改模型 |
| Node | ≥24.16.0；开发机器 26.7.0，服务器 26.8.1 |
| Telegram | 配置白名单中的私聊；现有账号与 Bot 凭据 |
| 主题、多账号 | 路由隔离有可控测试；实机只验收 default 账号的目标私聊 |
| 进度 | 单一自有气泡；同聊天更新串行合并，间隔默认 1500ms |
| 最终答案 | 原生 OpenClaw 交付；插件不拦截内容、附件、Markdown |
| 补充与停止 | 保留原生 steer/stop；显示收件和明确取消终态 |
| 重启 | 已知 messageId 收尾；不重建旧任务，不重发不确定的 send |

依赖锁在 package-lock.json，peerDependency 与 `openclaw.compat.pluginApi` 精确固定 `2026.9.1`，`openclaw.build.openclawVersion` 声明构建宿主版本。安装包 `dist/build-info.json` 记录构建的 Git 提交。最低宿主版本字段是安装门槛，不代表兼容所有后续版本。

GitHub CI 运行类型检查、Vitest、构建、打包、官方 `npm-pack:` 安装和基线升级/回滚生命周期。基线标签永久保留。增强版沿用原配置，新增语言与显示方式默认中文、详细；旧状态文件只收尾，不恢复旧任务。

升级步骤：在隔离目录更换指定版本 → 编译公开 SDK 类型 → 运行契约与生命周期测试 → 用测试私聊验证 Agent stream 和发送成功事件 → 更新兼容声明后部署。不能仅放宽 peerDependency。

当 OpenClaw 没有提供足够关联字段，或同 sessionKey 存在多个候选任务时，本插件跳过该事件。状态跟踪失败不改变模型的任务；`/status`、`/stop` 和原生回复继续由 OpenClaw 处理。
