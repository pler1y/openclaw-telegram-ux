import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { Audit } from "./audit.js";
import { botTokenOf, chatIdOf, type Settings } from "./config.js";
import { Controller, type Identity } from "./controller.js";
import { JsonTaskStore } from "./store.js";
import { TelegramTransport } from "./telegram.js";

/** Public SDK boundary. Observers return synchronously; transport runs in Controller's outbox. */
export function registerAdapter(api: OpenClawPluginApi, settings: Settings): void {
  let controller: Controller | undefined;
  let audit: Audit | undefined;
  let transport: TelegramTransport | undefined;
  const guard = (work: () => void): void => {
    try { work(); } catch { api.logger.warn("tgux_observer_failed"); }
  };
  api.registerService({
    id: "telegram-ux",
    async start(ctx) {
      transport = new TelegramTransport(botTokenOf(api, settings));
      const identity = await transport.identity();
      if (identity.username.toLowerCase() !== settings.expectedBotUsername.toLowerCase()) throw new Error("tgux_bot_identity_mismatch");
      const dir = join(ctx.stateDir, "telegram-ux");
      audit = new Audit(dir);
      controller = new Controller(settings, transport, new JsonTaskStore(dir), event => audit!.write(event));
      await controller.start();
      audit.write({ event: "ready", kind: "2026.9.1" });
    },
    async stop() {
      try { await controller?.stop(); } finally { await audit?.flush(); await transport?.close(); controller = undefined; }
    },
  });

  api.on("message_received", (event, ctx) => guard(() => {
    if (ctx.channelId !== "telegram" || (ctx.accountId ?? "default") !== settings.accountId) return;
    const chatId = chatIdOf(ctx.conversationId);
    const sessionKey = ctx.sessionKey ?? event.sessionKey;
    const inboundId = ctx.messageId ?? event.messageId;
    if (!chatId || !sessionKey || !inboundId || !settings.allowedChatIds.includes(chatId)) return;
    // Fast native commands remain native; do not leave a bubble for /status or /stop.
    if (/^\s*\//.test(event.content)) return;
    const threadId = event.threadId === undefined ? undefined : Number(event.threadId);
    if (threadId !== undefined && (!Number.isSafeInteger(threadId) || threadId <= 0)) return;
    controller?.receive({ route: { accountId: ctx.accountId ?? "default", chatId, threadId }, sessionKey, inboundId, runId: ctx.runId ?? event.runId });
  }));

  api.agent.events.registerAgentEventSubscription({
    id: "telegram-ux-progress",
    streams: ["lifecycle", "thinking", "tool", "approval"],
    handle(event) { guard(() => {
      const id = { sessionKey: event.sessionKey, runId: event.runId };
      const d = event.data;
      const options = { seq: event.seq };
      if (event.stream === "lifecycle") {
        if (d.phase === "start") controller?.event(id, { type: "thinking" }, { ...options, bind: true });
        else if (d.phase === "finishing") controller?.event(id, { type: "organizing" }, options);
        else if (d.phase === "end" || d.phase === "error") controller?.event(id, { type: "finish", result: d.aborted === true ? "cancelled" : d.phase === "error" ? "failed" : "success" }, options);
      } else if (event.stream === "thinking") controller?.event(id, { type: "thinking" }, options);
      else if (event.stream === "tool" && typeof d.toolCallId === "string") {
        if (d.phase === "start") controller?.event(id, { type: "tool_start", id: d.toolCallId, search: typeof d.name === "string" && /search|fetch|browser/i.test(d.name) }, options);
        else if (d.phase === "result") controller?.event(id, { type: "tool_end", id: d.toolCallId }, options);
      } else if (event.stream === "approval") {
        if (d.phase === "requested" || d.phase === "pending") controller?.event(id, { type: "approval", waiting: true }, options);
        else if (d.phase === "resolved") controller?.event(id, { type: "approval", waiting: false }, options);
      }
    }); },
  });

  // Additional public hooks cover embedded paths. On the target xAI path the
  // public Agent stream is the verified source; hooks may be absent.
  api.on("model_call_started", (event, ctx) => guard(() => {
    controller?.event({ runId: event.runId, sessionKey: ctx.sessionKey ?? event.sessionKey }, { type: "thinking" }, { bind: true });
  }));
  api.on("model_call_ended", () => { /* Per-call errors may be retried by OpenClaw. */ });
  api.on("before_tool_call", (event, ctx) => guard(() => {
    const callId = ctx.toolCallId ?? event.toolCallId;
    if (callId) controller?.event({ runId: ctx.runId ?? event.runId, sessionKey: ctx.sessionKey }, { type: "tool_start", id: callId, search: /search|fetch|browser/i.test(event.toolName) });
  }));
  api.on("after_tool_call", (event, ctx) => guard(() => {
    const callId = ctx.toolCallId ?? event.toolCallId;
    if (callId) controller?.event({ runId: ctx.runId ?? event.runId, sessionKey: ctx.sessionKey }, { type: "tool_end", id: callId });
  }));
  api.on("agent_end", (event, ctx) => guard(() => {
    controller?.event({ runId: ctx.runId ?? event.runId, sessionKey: ctx.sessionKey }, { type: "finish", result: event.success ? "success" : "failed" });
  }));
  const outgoing = (ctx: { channelId: string; accountId?: string; conversationId?: string; sessionKey?: string; runId?: string }, runId?: string): Identity | undefined => {
    if (ctx.channelId !== "telegram" || (ctx.accountId ?? "default") !== settings.accountId) return;
    const chatId = chatIdOf(ctx.conversationId);
    if (!chatId || !settings.allowedChatIds.includes(chatId)) return;
    return { sessionKey: ctx.sessionKey, runId: ctx.runId ?? runId, route: { accountId: ctx.accountId ?? "default", chatId } };
  };
  api.on("reply_payload_sending", (event, ctx) => guard(() => {
    const id = outgoing({ ...ctx, sessionKey: ctx.sessionKey ?? event.sessionKey }, event.runId);
    if (id && event.kind === "final") controller?.finalIntent(id);
  }));
  api.on("message_sent", (event, ctx) => guard(() => {
    const id = outgoing({ ...ctx, sessionKey: ctx.sessionKey ?? event.sessionKey }, event.runId);
    if (id) controller?.delivered(id, event.success, event.messageId && /^[0-9]+$/.test(event.messageId) ? Number(event.messageId) : undefined);
  }));
  api.registerHook("command:stop", event => guard(() => {
    if (event.sessionKey) controller?.event({ sessionKey: event.sessionKey }, { type: "cancel" });
  }), { name: "telegram-ux-stop", description: "Observe native stop without intercepting it" });
  api.lifecycle.registerRuntimeLifecycle({ id: "telegram-ux-cleanup", cleanup(ctx) { guard(() => controller?.cleanup(ctx)); } });
  api.registerCommand({
    name: "tgux", description: "查看中文任务进度状态", channels: ["telegram"], requireAuth: true,
    handler(ctx) {
      const chatId = chatIdOf(ctx.to) ?? chatIdOf(ctx.from) ?? chatIdOf(ctx.senderId);
      if ((ctx.accountId ?? "default") !== settings.accountId || !chatId || !settings.allowedChatIds.includes(chatId)) return { text: "当前会话未启用 Telegram UX。" };
      const status = controller?.status();
      return { text: `Telegram UX 0.1.0-beta.1\n状态：${status?.ready ? "已启用" : "未就绪"}\n正在跟踪：${status?.active ?? 0} 个任务\n中文回执 · 思考/搜索/工具进度 · 停止提示\n补充消息确认收到；最终答案由 OpenClaw 发送。\n${status?.failures ? `本次运行有 ${status.failures} 次状态更新异常，原生回复继续正常处理。` : "状态更新正常。"}` };
    },
  });
}
