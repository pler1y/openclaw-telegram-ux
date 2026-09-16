# 公开接口证据（OpenClaw 2026.9.1）

[架构](architecture.md) · [版本验证记录](../releases/0.2.0-beta.1-validation.md)

依赖基准为官方 npm `openclaw@2026.9.1`、版本标记 `ad6fe23`。源代码只导入 `openclaw/plugin-sdk/plugin-entry`，没有 OpenClaw 私有模块、Telegram channel 内部实现或 core 修改。

| 能力 | 公开接口与证据 | 0.2.0-beta.1 验证 |
| --- | --- | --- |
| 插件定义、服务、命令 | [SDK entrypoints](https://github.com/openclaw/openclaw/blob/v2026.9.1/docs/plugins/sdk-entrypoints.md)，`definePluginEntry`、`registerService`、`registerCommand` 的官方类型 | 插件加载成功；`/tgux` 直接返回状态 |
| 入站路由 | [Typed hooks](https://github.com/openclaw/openclaw/blob/v2026.9.1/docs/plugins/hooks.md)，`message_received` | 收到 accountId、conversationId、sessionKey、messageId；该路径未携带 runId |
| Run 关联 | [SDK overview](https://github.com/openclaw/openclaw/blob/v2026.9.1/docs/plugins/sdk-overview.md)，`api.agent.events.registerAgentEventSubscription` | 生命周期 start 的 runId 绑定同会话唯一待运行入站；存在歧义时跳过 |
| 思考、工具、终态 | [Agent loop](https://github.com/openclaw/openclaw/blob/v2026.9.1/docs/concepts/agent-loop.md)，公开 `thinking/tool/lifecycle` stream | tool start/result、lifecycle start/finishing/end/error；取消时 aborted=true |
| 模型与工具 typed hooks | 官方 `OpenClawPluginApi.on` 类型；model_call_started/ended、before/after_tool_call、agent_end | 当前 xAI 用户任务路径没有观察到这些 typed 回调；使用上行公开 Agent stream。保留 typed 适配和精确版本编译检查 |
| 最终交付 | `reply_payload_sending`、`message_sent` 和 lifecycle end | 文本路径收到发送确认后清理；当前附件路径未观察到发送确认，明确成功结束后等待 5–10 秒清理。状态清理不等于对原生附件送达的确认；实机另以 Telegram 界面验证附件 |
| 停止 | [Automation hooks](https://github.com/openclaw/openclaw/blob/v2026.9.1/docs/automation/hooks.md)，`command:stop`；以及 lifecycle aborted | 当前机器以 lifecycle 的明确 aborted 事件为已验证终态。无可关联 sessionKey 的 stop hook 跳过 |
| 服务清理 | `api.lifecycle.registerRuntimeLifecycle` 与 service.stop | Gateway 重启执行清理；持久状态在新进程中只收尾，不恢复运行 |
| 自有消息操作 | [Telegram Bot API](https://core.telegram.org/bots/api#updating-messages)：sendMessage/editMessageText/deleteMessage/getMe | 探针状态消息跨阶段多次编辑并成功删除；取消后编辑为已停止 |
| 具体工作进度 | [Tools and commands](https://docs.openclaw.ai/plugins/sdk-overview/tools-and-commands)，`registerTool` 工厂及 manifest `contracts.tools` | 工具只有一个有长度限制的 text 参数；账号、聊天与 session 来自宿主上下文，调用 ID 必须先由公开事件绑定当前 run |
| 菜单与续问 | [Infrastructure](https://docs.openclaw.ai/plugins/sdk-overview/infrastructure)，`registerInteractiveHandler`、返回 `submitText` | Telegram namespace 回调；校验授权用户、路由、消息、随机 nonce、有效期与任务代次。续问返回原生入站流程 |
| 可选进度引导 | `before_prompt_build` 返回 appendSystemContext | 受宿主 hook 权限约束；不强制开启 prompt 修改权限。工具自己的描述可独立说明用法 |
| 上下文压缩 | `before_compaction`、`after_compaction` | 只更新能够用可信 run/session 唯一关联的状态；没有关联时不创建气泡 |
| 后台任务 | `subagent_spawned`、`subagent_progress`、`subagent_ended` | 关联 requesterSessionKey 或明确 route+入站 ID，按 child runId 去重。父任务完成后仍有子任务时继续等候 |

探针通过项：正确入站关联、取得 Bot API 消息 ID、至少两次跨阶段编辑、正常完成清理、补充收件提示、原生停止后的确定终态、服务重启收尾。探针只保存 ID、时间、阶段和字段名，不保存字段中的正文。

公开事件的 `data` 属于开放结构，本插件只读取固定的 `phase/name/toolCallId/aborted` 字段，不读取或存储 thinking 文本、args、result。新增事件形状必须先验证，不把任意字符串当成可执行指令。

补充被采纳的明确事件在当前目标路径未得到验证，故界面只显示“补充已收到”。审批 stream 的已识别 phase 做可控契约覆盖，未宣称真实审批验收。

HTTP 客户端使用固定 `undici@8.10.0` 的公开 Agent 与 fetch，独立设置连接超时和地址族尝试时限。仅 `UND_ERR_CONNECT_TIMEOUT`（连接尚未建立）及 Telegram 明确的 429 拒绝可重试 create；其他发送结果不确定时不重发。错误日志只记录固定白名单中的错误码。参考 [Undici](https://github.com/nodejs/undici/tree/v8.10.0)。

## 停止与入站边界

固定版本原生整条停止短句包含“停止”“停下来”“暂停”。插件只识别这些短句以避免创建多余状态消息，不改写或接管停止请求。是否真正中止以原生明确事件为准。

公开交互处理器的 `submitText` 没有 `expectedRunId` 一类原子停止约束；即使点击时检查 run，也无法保证原生队列执行停止时仍是同一 run。因此不提供停止按钮。旧续问菜单只提交无副作用的明确续问，并进行任务代次校验；过期或重启前 nonce 失效。

`before_dispatch` 是接管入口而非原生消息重写接口，`registerTextTransforms` 也不是 Telegram 命令重写入口。本版没有借这些接口把“等一下”“停”等额外短句伪装成 /stop。普通文字仍按原生模型理解处理。

没有使用 `api.runtime.gateway.request`、宿主私有 abort 函数或运行时方法替换。压缩和子任务接口的存在与当前模型是否触发是两件事，实机观察范围单独记录在测试报告中。
