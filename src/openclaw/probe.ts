import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { Audit } from "../storage/audit.js";
import { botTokenOf, chatIdOf, type Settings } from "./config.js";
import { TelegramTransport, TransportError, type Route } from "../telegram/transport.js";

type ProbeRun = { route: Route; sessionKey: string; runId?: string; inboundId?: string; messageId?: number; terminal: boolean; chain: Promise<void>; lastAt: number; lastText?: string; attempted?: boolean; ended?: boolean; delivered?: boolean };

export function registerProbe(api: OpenClawPluginApi, settings: Settings): void {
  let ready = false;
  let audit: Audit | undefined;
  const transport = new TelegramTransport(botTokenOf(api, settings));
  const sessions = new Map<string, ProbeRun>();
  const log = (event: string, r: ProbeRun, extra = {}) => audit?.write({ event, sessionKey: r.sessionKey, runId: r.runId, ...r.route, inboundId: r.inboundId, messageId: r.messageId, ...extra });
  const update = (r: ProbeRun, text: string, terminal = false, remove = false) => {
    if (r.terminal) return;
    if (r.lastText === text && !terminal) return;
    r.lastText = text;
    if (terminal) r.terminal = true;
    r.chain = r.chain.then(async () => {
      const wait = r.lastAt + settings.editIntervalMs - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      if (r.messageId === undefined) {
        if (r.attempted) return;
        r.attempted = true;
        r.messageId = await transport.create(r.route, text);
        log("created", r);
      } else if (remove) {
        await transport.delete(r.route, r.messageId);
        log("deleted", r);
      } else {
        await transport.edit(r.route, r.messageId, text);
        log("edited", r, { phase: text });
      }
      r.lastAt = Date.now();
    }).catch(e => log("transport_error", r, { kind: e instanceof TransportError ? e.kind : "internal" }));
  };
  const find = (sessionKey?: string, runId?: string) => {
    const r = (sessionKey ? sessions.get(sessionKey) : undefined) ?? (runId ? [...sessions.values()].find(r => r.runId === runId) : undefined);
    if (!r) { if (sessions.size) audit?.write({ event: "uncorrelated", sessionKey, runId }); return; }
    if (runId && r.runId && runId !== r.runId) {
      log("run_mismatch", r, { runId });
      return;
    }
    if (runId && !r.runId) { r.runId = runId; log("bound", r); }
    return r;
  };
  api.registerService({
    id: "tgux-probe",
    async start(ctx) {
      audit = new Audit(join(ctx.stateDir, "telegram-ux"));
      const identity = await transport.identity();
      if (identity.username !== settings.expectedBotUsername) throw new Error("tgux_bot_identity_mismatch");
      ready = true;
      audit.write({ event: "probe_ready" });
    },
    async stop() {
      ready = false;
      for (const r of sessions.values()) update(r, "服务已重启，本次状态跟踪结束。", true);
      await Promise.all([...sessions.values()].map(r => r.chain));
      await audit?.flush();
      await transport.close();
    },
  });
  api.on("message_received", (event, ctx) => {
    if (!ready || ctx.channelId !== "telegram" || (ctx.accountId ?? "default") !== settings.accountId || !event.content.includes("UX-PROBE")) return;
    const chatId = chatIdOf(ctx.conversationId);
    const sessionKey = ctx.sessionKey ?? event.sessionKey;
    if (!chatId || !settings.allowedChatIds.includes(chatId) || !sessionKey) {
      audit?.write({ event: "inbound_unresolved", keys: Object.keys(ctx), sessionKey, chatId }); return;
    }
    const previous = sessions.get(sessionKey);
    if (previous && !previous.terminal) { log("supplement_received", previous); update(previous, "补充已收到，正在继续处理…"); return; }
    const r: ProbeRun = {
      route: { accountId: settings.accountId, chatId, threadId: event.threadId === undefined ? undefined : Number(event.threadId) },
      sessionKey, runId: ctx.runId ?? event.runId, inboundId: ctx.messageId ?? event.messageId,
      terminal: false, chain: Promise.resolve(), lastAt: 0,
    };
    sessions.set(sessionKey, r);
    log("inbound", r, { keys: Object.keys(ctx) });
    update(r, "收到，正在处理…");
  });
  api.on("before_agent_reply", (_event, ctx) => { audit?.write({ event: "reply_context", sessionKey: ctx.sessionKey, runId: ctx.runId, keys: Object.keys(ctx) }); });
  api.on("llm_input", (event, ctx) => { const r = find(ctx.sessionKey, event.runId); if (r) { log("llm_input", r, { keys: Object.keys(ctx) }); update(r, "正在思考…"); } });
  api.on("model_call_started", (event, ctx) => { const r = find(ctx.sessionKey ?? event.sessionKey, event.runId); if (r) { log("model_started", r); update(r, "正在思考…"); } });
  api.on("model_call_ended", (event, ctx) => { const r = find(ctx.sessionKey ?? event.sessionKey, event.runId); if (r) log("model_ended", r, { phase: event.outcome }); });
  api.on("before_tool_call", (event, ctx) => { const r = find(ctx.sessionKey, ctx.runId ?? event.runId); if (r) { log("tool_started", r); update(r, /search|fetch|browser/.test(event.toolName) ? "正在搜索资料…" : "正在执行工具…"); } });
  api.on("after_tool_call", (event, ctx) => { const r = find(ctx.sessionKey, ctx.runId ?? event.runId); if (r) { log("tool_ended", r, { success: !event.error }); update(r, "正在整理结果…"); } });
  api.on("agent_end", (event, ctx) => { const r = find(ctx.sessionKey, ctx.runId ?? event.runId); if (r) { log("agent_end", r, { success: event.success }); update(r, event.success ? "处理完成。" : "本次任务未能完成。", true, event.success); } });
  api.on("message_sent", (event, ctx) => { const r = find(ctx.sessionKey, ctx.runId ?? event.runId); if (r) { log("message_sent", r, { success: event.success }); r.delivered = event.success; if (r.ended && r.delivered) update(r, "处理完成。", true, true); } });
  api.registerHook("command:stop", event => { const r = find(event.sessionKey); if (r) { log("stop", r); update(r, "已停止。", true); } }, { name: "tgux-stop", description: "Observe native stop" });
  api.lifecycle.registerRuntimeLifecycle({ id: "tgux-probe-cleanup", cleanup(ctx) { for (const r of sessions.values()) if ((!ctx.sessionKey || r.sessionKey === ctx.sessionKey) && (!ctx.runId || r.runId === ctx.runId)) { log("cleanup", r, { phase: ctx.reason }); update(r, "本次状态跟踪已结束。", true); } } });
  api.agent.events.registerAgentEventSubscription({ id: "tgux-probe-events", streams: ["lifecycle", "tool", "thinking", "approval", "error"], handle(event) {
    const r = find(event.sessionKey, event.runId); if (!r) return;
    const d = event.data;
    if (event.stream !== "thinking") log("agent_event", r, { kind: event.stream, keys: Object.keys(d), phase: typeof d.phase === "string" && /^[a-z_:-]{1,40}$/i.test(d.phase) ? d.phase : undefined });
    if (event.stream === "thinking" || (event.stream === "lifecycle" && d.phase === "start")) update(r, "正在思考…");
    if (event.stream === "tool" && d.phase === "start") update(r, /search|fetch|browser/.test(String(d.name)) ? "正在搜索资料…" : "正在执行工具…");
    if (event.stream === "tool" && d.phase === "result") update(r, "正在整理结果…");
    if (event.stream === "lifecycle" && d.phase === "finishing") update(r, "正在整理结果…");
    if (event.stream === "lifecycle" && (d.phase === "end" || d.phase === "error")) {
      log("runtime_end", r, { phase: d.aborted === true ? "cancelled" : d.phase === "error" ? "failed" : "completed" });
      if (d.aborted === true) update(r, "已停止。", true);
      else if (d.phase === "error") update(r, "本次任务未能完成。", true);
      else { r.ended = true; if (r.delivered) update(r, "处理完成。", true, true); }
    }
  } });
  api.registerCommand({ name: "tgux", description: "查看中文任务进度状态", channels: ["telegram"], requireAuth: true, handler: () => ({ text: `Telegram UX 0.1.0-beta.1\n能力探针：${ready ? "已就绪" : "未就绪"}\n仅处理本私聊中的 UX-PROBE 测试任务。` }) });
}
