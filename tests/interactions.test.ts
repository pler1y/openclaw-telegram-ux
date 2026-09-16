import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Interactions } from "../src/telegram/interactions.js";
import { PreferenceStore } from "../src/storage/preferences.js";
import { settingsOf } from "../src/openclaw/config.js";
import type { Controller } from "../src/core/controller.js";
import { TransportError, type Buttons, type MessageTransport } from "../src/telegram/transport.js";

const route = { accountId: "default", chatId: "123" };
const settings = settingsOf({ allowedChatIds: ["123"], expectedBotUsername: "fixture_bot" });
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "tgux-prefs-test-")); });
afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }); });
async function setup(buttons = true) {
  const prefs = new PreferenceStore(dir, { language: "zh", progressStyle: "detailed" }); await prefs.load();
  const view = { ready: true, generation: "task1", active: 0 };
  const controller = { view: () => view, refresh: vi.fn(), dispatch: async (_route: unknown, work: () => Promise<unknown>) => work() };
  const transport = { create: vi.fn<MessageTransport["create"]>().mockResolvedValue(42), edit: vi.fn<MessageTransport["edit"]>().mockResolvedValue(), delete: vi.fn<MessageTransport["delete"]>().mockResolvedValue() };
  const audit = vi.fn(); const menu = new Interactions(settings, controller as unknown as Controller, transport, prefs, buttons, audit);
  await menu.show(route, "123", "s1");
  const callback = (action: string, id = "callback1") => {
    const markup = transport.create.mock.calls.at(-1)?.[2] as Buttons;
    const data = markup.flat().find(b => b.callback_data.endsWith(`:${action}`))!.callback_data;
    return { channel: "telegram", accountId: "default", conversationId: "123", senderId: "123", callbackId: id, isGroup: false, auth: { isAuthorizedSender: true }, callback: { namespace: "tgux", payload: data.slice(5), messageId: 42, chatId: "123" } };
  };
  return { menu, prefs, transport, controller, view, audit, callback };
}
describe("owned interactive menus", () => {
  it("persists only preferences, restores them, and updates the same owned menu", async () => {
    const { menu, callback, prefs, transport, controller } = await setup();
    await menu.handle(callback("en")); expect(prefs.get(route).language).toBe("en");
    expect(transport.edit.mock.calls.at(-1)?.[1]).toBe(42); expect(transport.edit.mock.calls.at(-1)?.[2]).toContain("Enabled");
    expect(controller.refresh).toHaveBeenCalled();
    const stored = await readFile(join(dir, "preferences.json"), "utf8"); expect(stored).not.toMatch(/message|token|task1|callback/);
    const restored = new PreferenceStore(dir, { language: "zh", progressStyle: "compact" }); await restored.load(); expect(restored.get(route)).toEqual({ language: "en", progressStyle: "detailed" });
  });
  it("does not lose concurrent language/style preference changes", async () => {
    const { prefs } = await setup(); await Promise.all([prefs.set(route, { language: "en" }), prefs.set(route, { progressStyle: "compact" })]);
    expect(prefs.get(route)).toEqual({ language: "en", progressStyle: "compact" });
  });
  it("rejects unauthorized, wrong-owner and forged-message callbacks", async () => {
    const { menu, callback, prefs, transport } = await setup();
    const noAuth = callback("en"); noAuth.auth.isAuthorizedSender = false;
    const wrongUser = callback("en"); wrongUser.senderId = "456";
    const wrongMessage = callback("en"); wrongMessage.callback.messageId = 99;
    const wrongChat = callback("en"); wrongChat.conversationId = "456";
    for (const ctx of [noAuth, wrongUser, wrongMessage, wrongChat]) await menu.handle(ctx);
    expect(prefs.get(route).language).toBe("zh"); expect(transport.edit).not.toHaveBeenCalled();
  });
  it("deduplicates callbacks and accepts unchanged Telegram edits", async () => {
    const { menu, callback, transport, audit } = await setup();
    transport.edit.mockRejectedValueOnce(new TransportError("unchanged"));
    const ctx = callback("status"); await menu.handle(ctx); await menu.handle(ctx);
    expect(transport.edit).toHaveBeenCalledOnce(); expect(audit.mock.calls.map(c => c[0])).not.toContain("menu_update_failed");
  });
  it("rejects expired and invalidated controls", async () => {
    const { menu, callback, transport } = await setup();
    const ctx = callback("en");
    const now = Date.now(); const clock = vi.spyOn(Date, "now").mockReturnValue(now + 600_001);
    await menu.handle(ctx); expect(transport.edit).not.toHaveBeenCalled();
    clock.mockRestore(); menu.invalidate("s1"); await menu.handle(ctx); expect(transport.edit).not.toHaveBeenCalled();
  });
  it("submits one explicit follow-up through the native path", async () => {
    const { menu, callback } = await setup();
    expect(await menu.handle(callback("summary"))).toEqual({ handled: true, submitText: "请简要总结刚才的回答。" });
    expect(await menu.handle(callback("summary", "duplicate-click"))).toEqual({ handled: true });
  });
  it("does not submit a follow-up after a newer task started", async () => {
    const { menu, callback, view } = await setup(); view.generation = "task2";
    expect(await menu.handle(callback("explain"))).toEqual({ handled: true });
  });
  it("honors disabled inline buttons and provides slash-command settings", async () => {
    const { menu, transport, prefs } = await setup(false);
    expect(transport.create.mock.calls[0]?.[2]).toEqual([]);
    await menu.show(route, "123", "s1", "lang en"); expect(prefs.get(route).language).toBe("en");
    await menu.show(route, "123", "s1", "help"); expect(transport.create.mock.calls.at(-1)?.[1]).toContain("/stop");
  });
  it("keeps callback payloads inside Telegram's 64-byte limit and never creates a stop callback", async () => {
    const { transport } = await setup();
    for (const b of transport.create.mock.calls[0]![2]!.flat()) { expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64); expect(b.callback_data).not.toMatch(/:stop$/); }
  });
});
