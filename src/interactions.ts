import { randomBytes } from "node:crypto";
import type { Controller } from "./controller.js";
import { chatIdOf, type Settings } from "./config.js";
import { PreferenceStore } from "./preferences.js";
import { textOf, VERSION, type Preferences } from "./presentation.js";
import { TransportError, type Buttons, type MessageTransport, type Route } from "./telegram.js";

type Action = "status" | "help" | "zh" | "en" | "compact" | "detailed" | "explain" | "summary";
type Lease = { nonce: string; route: Route; senderId: string; sessionKey: string; generation?: string; messageId?: number; expiresAt: number; callbacks: Set<string>; followup: boolean };
interface CallbackContext {
  channel: string; accountId: string; conversationId: string; senderId?: string; callbackId: string; isGroup: boolean;
  auth: { isAuthorizedSender: boolean };
  callback: { namespace: string; payload: string; messageId: number; chatId: string };
}
function callbackContext(value: unknown): CallbackContext | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Partial<CallbackContext>;
  if (v.channel !== "telegram" || v.isGroup !== false || typeof v.accountId !== "string" || typeof v.conversationId !== "string"
    || typeof v.callbackId !== "string" || typeof v.senderId !== "string" || v.auth?.isAuthorizedSender !== true
    || v.callback?.namespace !== "tgux" || typeof v.callback.payload !== "string" || typeof v.callback.chatId !== "string"
    || !Number.isSafeInteger(v.callback.messageId)) return;
  return v as CallbackContext;
}

export class Interactions {
  private leases = new Map<string, Lease>();
  constructor(private readonly settings: Settings, private readonly controller: Controller, private readonly transport: MessageTransport, private readonly prefs: PreferenceStore, private readonly buttonsEnabled: boolean, private readonly audit: (event: string, kind?: string) => void) {}

  private copy(route: Route, page: "status" | "help" = "status"): string {
    const p = this.prefs.get(route); const language = p.language;
    if (page === "help") return textOf(language,
      "正常发送消息即可；多步骤任务会在同一气泡显示进度，成功后自动清理。\n补充要求会确认收到；是否采纳由原生任务决定。\n停止：发送 /stop，或单独发送“停止”“停下来”“暂停”。停止不是可恢复的暂停。\n/tgux lang zh 或 en：切换界面语言\n/tgux style compact 或 detailed：切换显示方式\n最终答案与附件由 OpenClaw 发送。",
      "Send a message normally. Multi-step progress stays in one bubble, which is removed on success.\nAdditional instructions are acknowledged as received; the native task handles them.\nStop: send /stop, stop, or stop please as a whole message. Stopping does not create a resumable pause.\n/tgux lang zh or en: interface language\n/tgux style compact or detailed: display style\nOpenClaw delivers the final answer and attachments.");
    const view = this.controller.view(route);
    return `Telegram UX ${VERSION}\n` + textOf(language,
      `状态：${view.ready ? "已启用" : "未就绪"}\n正在跟踪：${view.active} 个任务\n界面：${language === "zh" ? "中文" : "English"} · ${p.progressStyle === "detailed" ? "详细进度" : "简洁进度"}\n即时回执 · 具体进度 · 原生停止提示\n补充消息确认收到；最终答案由 OpenClaw 发送。`,
      `Status: ${view.ready ? "Enabled" : "Not ready"}\nTracking: ${view.active} task(s)\nInterface: English · ${p.progressStyle === "detailed" ? "Detailed" : "Compact"} progress\nInstant receipts · Task updates · Native stop feedback\nAdditional messages are acknowledged; OpenClaw delivers the final answer.`);
  }

  private buttons(lease: Lease, p: Preferences): Buttons {
    if (!this.buttonsEnabled) return [];
    const button = (action: Action, zh: string, en: string) => ({ text: textOf(p.language, zh, en), callback_data: `tgux:${lease.nonce}:${action}` });
    return [
      [button("status", "任务状态", "Status"), button("help", "帮助与停止方法", "Help / stopping")],
      [button("zh", "中文", "中文"), button("en", "English", "English")],
      [button("compact", "简洁", "Compact"), button("detailed", "详细", "Detailed")],
      ...(lease.followup ? [[button("explain", "继续解释", "Explain more"), button("summary", "简要总结", "Summarize")]] : []),
    ];
  }

  async show(route: Route, senderId: string, sessionKey: string, args = ""): Promise<void> {
    const command = args.trim().toLowerCase();
    if (command === "lang zh" || command === "lang en") await this.prefs.set(route, { language: command.endsWith("en") ? "en" : "zh" });
    else if (command === "style compact" || command === "style detailed") await this.prefs.set(route, { progressStyle: command.endsWith("compact") ? "compact" : "detailed" });
    else if (command && command !== "status" && command !== "help") args = "help";
    this.controller.refresh(route);
    const view = this.controller.view(route, sessionKey);
    const lease: Lease = { nonce: randomBytes(12).toString("hex"), route, senderId, sessionKey, generation: view.generation, expiresAt: Date.now() + 600_000, callbacks: new Set(), followup: view.active === 0 && !!view.generation };
    for (const [key, old] of this.leases) if (old.expiresAt <= Date.now() || (old.route.accountId === route.accountId && old.route.chatId === route.chatId && old.senderId === senderId)) this.leases.delete(key);
    if (this.leases.size >= 500) this.leases.delete(this.leases.keys().next().value!);
    this.leases.set(lease.nonce, lease);
    try {
      lease.messageId = await this.controller.dispatch(route, () => this.transport.create(route, this.copy(route, args === "help" ? "help" : "status"), this.buttons(lease, this.prefs.get(route))));
      this.audit("menu_created");
    } catch { this.leases.delete(lease.nonce); throw new Error("tgux_menu_unavailable"); }
  }

  async handle(value: unknown): Promise<{ handled: true; submitText?: string }> {
    const ctx = callbackContext(value);
    const handled = { handled: true } as const;
    if (!ctx) { this.audit("callback_rejected", "untrusted_context"); return handled; }
    if (!ctx || ctx.accountId !== this.settings.accountId || !this.settings.allowedChatIds.includes(ctx.callback.chatId) || ctx.senderId !== ctx.callback.chatId) return handled;
    const match = /^([a-f0-9]{24}):(status|help|zh|en|compact|detailed|explain|summary)$/.exec(ctx.callback.payload);
    if (!match) return handled;
    const lease = this.leases.get(match[1]!); const action = match[2] as Action;
    if (!lease || lease.expiresAt <= Date.now()) { this.audit("callback_rejected", "expired"); return handled; }
    if (lease.messageId !== ctx.callback.messageId || lease.route.chatId !== ctx.callback.chatId || lease.route.chatId !== chatIdOf(ctx.conversationId)
      || lease.route.accountId !== ctx.accountId || lease.senderId !== ctx.senderId || lease.callbacks.has(ctx.callbackId)) { this.audit("callback_rejected", "ownership_or_duplicate"); return handled; }
    lease.callbacks.add(ctx.callbackId);
    if (lease.callbacks.size > 128) { this.leases.delete(lease.nonce); return handled; }
    if (action === "explain" || action === "summary") {
      const view = this.controller.view(lease.route, lease.sessionKey);
      if (!lease.followup || !view.ready || view.active || view.generation !== lease.generation) { this.audit("callback_rejected", "stale_task"); return handled; }
      this.leases.delete(lease.nonce);
      this.audit("followup_submitted", action);
      return { handled: true, submitText: action === "explain" ? textOf(this.prefs.get(lease.route).language, "请继续解释刚才的回答，补充必要的细节。", "Please explain your previous answer further, adding useful details.") : textOf(this.prefs.get(lease.route).language, "请简要总结刚才的回答。", "Please briefly summarize your previous answer.") };
    }
    try {
      if (action === "zh" || action === "en") await this.prefs.set(lease.route, { language: action });
      if (action === "compact" || action === "detailed") await this.prefs.set(lease.route, { progressStyle: action });
      this.controller.refresh(lease.route);
      await this.controller.dispatch(lease.route, async () => {
        try { await this.transport.edit(lease.route, lease.messageId!, this.copy(lease.route, action === "help" ? "help" : "status"), this.buttons(lease, this.prefs.get(lease.route))); }
        catch (e) { if (!(e instanceof TransportError && e.kind === "unchanged")) throw e; }
      });
      this.audit("menu_updated", action);
    } catch (e) {
      if (!(e instanceof TransportError && e.kind === "unchanged")) this.audit("menu_update_failed");
    }
    return handled;
  }

  invalidate(sessionKey?: string): void { for (const [key, lease] of this.leases) if (!sessionKey || lease.sessionKey === sessionKey) this.leases.delete(key); }
}
