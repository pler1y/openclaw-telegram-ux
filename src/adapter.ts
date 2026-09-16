import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { Audit } from "./audit.js";
import { botTokenOf, chatIdOf, type Settings } from "./config.js";
import { Controller, type Identity } from "./controller.js";
import { JsonTaskStore } from "./store.js";
import { TelegramTransport } from "./telegram.js";
import { PreferenceStore } from "./preferences.js";
import { Interactions } from "./interactions.js";
import { isNativeStop, textOf } from "./presentation.js";
import { PROGRESS_TOOL, registerProgressTool } from "./progress-tool.js";

/** Public SDK boundary. Observers return synchronously; transport runs in Controller's outbox. */
export function registerAdapter(api: OpenClawPluginApi, settings: Settings): void {
  let controller: Controller | undefined;
  let audit: Audit | undefined;
  let transport: TelegramTransport | undefined;
  let preferences: PreferenceStore | undefined;
  let interactions: Interactions | undefined;
  registerProgressTool(api, settings, () => controller, route => preferences?.get(route) ?? { language: settings.language ?? "zh", progressStyle: settings.progressStyle ?? "detailed" });
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
      preferences = new PreferenceStore(dir, { language: settings.language ?? "zh", progressStyle: settings.progressStyle ?? "detailed" });
      await preferences.load();
      controller = new Controller(settings, transport, new JsonTaskStore(dir), event => audit!.write(event), route => preferences!.get(route));
      await controller.start();
      const telegram = api.config.channels?.telegram;
      const account = settings.accountId === "default" ? telegram : telegram?.accounts?.[settings.accountId];
      const capabilities = account?.capabilities ?? telegram?.capabilities;
      const buttonsEnabled = !(capabilities && !Array.isArray(capabilities) && capabilities.inlineButtons === "off");
      interactions = new Interactions(settings, controller, transport, preferences, buttonsEnabled, (event, kind) => audit!.write({ event, kind }));
      audit.write({ event: "ready", kind: "2026.9.1" });
    },
    async stop() {
      interactions?.invalidate();
      try { await controller?.stop(); } finally { await audit?.flush(); await transport?.close(); controller = undefined; interactions = undefined; }
    },
  });

  api.on("message_received", (event, ctx) => guard(() => {
    if (ctx.channelId !== "telegram" || (ctx.accountId ?? "default") !== settings.accountId) return;
    const chatId = chatIdOf(ctx.conversationId);
    const sessionKey = ctx.sessionKey ?? event.sessionKey;
    const inboundId = ctx.messageId ?? event.messageId;
    if (!chatId || !sessionKey || !inboundId || !settings.allowedChatIds.includes(chatId)) return;
    // Fast native commands remain native; do not leave a bubble for /status or /stop.
    if (/^\s*\//.test(event.content) || isNativeStop(event.content)) return;
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
        if (d.name === PROGRESS_TOOL) {
          if (d.phase === "start") controller?.trackProgressCall(id, d.toolCallId);
          return;
        }
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
    if (event.toolName === PROGRESS_TOOL) {
      if (callId) controller?.trackProgressCall({ runId: ctx.runId ?? event.runId, sessionKey: ctx.sessionKey }, callId);
      return;
    }
    if (callId) controller?.event({ runId: ctx.runId ?? event.runId, sessionKey: ctx.sessionKey }, { type: "tool_start", id: callId, search: /search|fetch|browser/i.test(event.toolName) });
  }));
  api.on("after_tool_call", (event, ctx) => guard(() => {
    if (event.toolName === PROGRESS_TOOL) return;
    const callId = ctx.toolCallId ?? event.toolCallId;
    if (callId) controller?.event({ runId: ctx.runId ?? event.runId, sessionKey: ctx.sessionKey }, { type: "tool_end", id: callId });
  }));
  api.on("agent_end", (event, ctx) => guard(() => {
    controller?.event({ runId: ctx.runId ?? event.runId, sessionKey: ctx.sessionKey }, { type: "finish", result: event.success ? "success" : "failed" });
  }));
  api.on("before_prompt_build", (_event, ctx) => {
    if (!ctx.sessionKey || (ctx.channel ?? ctx.messageProvider) !== "telegram" || (ctx.accountId ?? "default") !== settings.accountId) return;
    const chatId = chatIdOf(ctx.chatId ?? ctx.channelId);
    if (!chatId || !settings.allowedChatIds.includes(chatId)) return;
    const prefs = controller?.preferencesForSession(ctx.sessionKey);
    if (!prefs || prefs.progressStyle === "compact") return;
    return { appendSystemContext: textOf(prefs.language,
      "Telegram 进度展示：多步骤任务开始、重要阶段变化时，可调用 tgux_progress，用一句中文描述实际工作。简单回答无需调用。只写面向用户的工作说明，不写内部思考、工具输出、凭据或完成承诺；不要重复每个工具的状态。最终答案照常交付。",
      "Telegram progress: for multi-step work, use tgux_progress at the start and meaningful milestones with one English sentence about the actual work. Skip simple answers. Use public-facing activity only, not private reasoning, tool output, credentials, or completion claims. Do not repeat every tool status. Deliver the final answer normally.") };
  });
  api.on("before_compaction", (_event, ctx) => guard(() => {
    audit?.write({ event: "public_hook", kind: "before_compaction" });
    controller?.event({ sessionKey: ctx.sessionKey, runId: ctx.runId }, { type: "compaction", active: true });
  }));
  api.on("after_compaction", (_event, ctx) => guard(() => {
    audit?.write({ event: "public_hook", kind: "after_compaction" });
    controller?.event({ sessionKey: ctx.sessionKey, runId: ctx.runId }, { type: "compaction", active: false });
  }));
  const childStart = (event: { runId: string; childSessionKey: string; requester?: { channel?: string; accountId?: string; to?: string; messageId?: string | number } }, parentSessionKey?: string) => {
    audit?.write({ event: "public_hook", kind: "subagent_start" });
    const r = event.requester;
    if (r?.channel && r.channel !== "telegram") return;
    const chatId = chatIdOf(r?.to);
    if (r?.accountId && r.accountId !== settings.accountId) return;
    controller?.childStarted({ sessionKey: parentSessionKey, route: chatId ? { accountId: r?.accountId ?? settings.accountId, chatId } : undefined, inboundId: r?.messageId === undefined ? undefined : String(r.messageId) }, { runId: event.runId, sessionKey: event.childSessionKey });
  };
  api.on("subagent_spawned", (event, ctx) => guard(() => childStart(event, ctx.requesterSessionKey)));
  api.on("subagent_progress", (event, ctx) => guard(() => {
    if (event.phase === "started") childStart(event, ctx.requesterSessionKey);
    else controller?.childEnded({ runId: event.runId, sessionKey: event.childSessionKey }, event.outcome);
  }));
  api.on("subagent_ended", event => guard(() => controller?.childEnded({ runId: event.runId, sessionKey: event.targetSessionKey }, event.outcome === "ok" || event.outcome === "error" || event.outcome === "timeout" || event.outcome === "killed" ? event.outcome : "unknown")));
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
  api.lifecycle.registerRuntimeLifecycle({ id: "telegram-ux-cleanup", cleanup(ctx) { guard(() => { controller?.cleanup(ctx); interactions?.invalidate(ctx.sessionKey); }); } });
  api.registerInteractiveHandler({ channel: "telegram", namespace: "tgux", handler: ctx => interactions?.handle(ctx) ?? { handled: true } });
  api.registerCommand({
    name: "tgux", description: "Telegram UX · 状态、设置与帮助 / status, settings and help", channels: ["telegram"], requireAuth: true, acceptsArgs: true,
    async handler(ctx) {
      const chatId = chatIdOf(ctx.to) ?? chatIdOf(ctx.from) ?? chatIdOf(ctx.senderId);
      const language = settings.language ?? "zh";
      if (!ctx.isAuthorizedSender || (ctx.accountId ?? "default") !== settings.accountId || !chatId || !settings.allowedChatIds.includes(chatId) || ctx.senderId !== chatId) return { text: textOf(language, "当前会话未启用 Telegram UX。", "Telegram UX is not enabled for this conversation.") };
      if (!interactions || !ctx.sessionKey) return { text: textOf(language, "Telegram UX 尚未就绪，请稍后重试。", "Telegram UX is not ready. Please try again shortly.") };
      try { await interactions.show({ accountId: settings.accountId, chatId }, ctx.senderId, ctx.sessionKey, ctx.args); return { suppressReply: true }; }
      catch { return { text: textOf(preferences?.get({ accountId: settings.accountId, chatId }).language ?? language, "菜单暂时不可用；普通消息和 /stop 仍由 OpenClaw 处理。", "The menu is temporarily unavailable. OpenClaw still handles normal messages and /stop.") }; }
    },
  });
}
