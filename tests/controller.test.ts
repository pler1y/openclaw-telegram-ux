import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../src/core/controller.js";
import type { Settings } from "../src/openclaw/config.js";
import type { StoredTask, TaskStore } from "../src/storage/task-store.js";
import { TransportError, type MessageTransport } from "../src/telegram/transport.js";

class MemoryStore implements TaskStore {
  constructor(public data: StoredTask[] = []) {}
  async load() { return this.data; }
  save(data: StoredTask[]) { this.data = structuredClone(data); }
  async flush() {}
}
const settings: Settings = { mode: "active", accountId: "default", allowedChatIds: ["123", "456"], expectedBotUsername: "fixture_bot", editIntervalMs: 1500, statusTimeoutMs: 60000 };
const inbound = { route: { accountId: "default", chatId: "123" }, sessionKey: "s1", inboundId: "1" };
const id = { sessionKey: "s1", runId: "r1" };
let controllers: Controller[] = [];
async function setup(data: StoredTask[] = []) {
  const transport = { create: vi.fn<MessageTransport["create"]>().mockResolvedValue(42), edit: vi.fn<MessageTransport["edit"]>().mockResolvedValue(), delete: vi.fn<MessageTransport["delete"]>().mockResolvedValue() };
  const store = new MemoryStore(data); const audit = vi.fn();
  const controller = new Controller(settings, transport, store, audit);
  controllers.push(controller); await controller.start();
  return { controller, transport, store, audit };
}
async function tick(ms = 2000) { await vi.advanceTimersByTimeAsync(ms); }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); controllers = []; });
afterEach(async () => {
  const stopping = controllers.map(c => c.stop());
  await tick(15_000); await Promise.all(stopping); vi.useRealTimers();
});

describe("routing and lifecycle", () => {
  it("creates once, coalesces updates, and deletes only its own message after final delivery", async () => {
    const { controller: c, transport: t } = await setup();
    c.receive(inbound); await tick(0);
    c.event(id, { type: "thinking" }, { bind: true, seq: 1 });
    c.event(id, { type: "tool_start", id: "tool1", search: true }, { seq: 2 });
    c.event(id, { type: "tool_end", id: "tool1" }, { seq: 3 });
    await tick();
    expect(t.create).toHaveBeenCalledOnce();
    expect(t.edit).toHaveBeenCalledOnce();
    expect(t.edit).toHaveBeenLastCalledWith(inbound.route, 42, "正在整理结果…");
    c.event(id, { type: "finish", result: "success" });
    expect(t.delete).not.toHaveBeenCalled();
    c.delivered({ sessionKey: "s1", route: inbound.route }, true, 99); await tick();
    expect(t.delete).toHaveBeenCalledExactlyOnceWith(inbound.route, 42);
  });
  it("deduplicates inbound messages including supplements replayed after stop", async () => {
    const { controller: c, transport: t } = await setup();
    c.receive(inbound); c.receive(inbound); await tick(0);
    c.event(id, { type: "thinking" }, { bind: true });
    const supplement = { ...inbound, inboundId: "2" };
    c.receive(supplement); await tick();
    expect(t.edit.mock.calls.at(-1)?.[2]).toContain("补充已收到");
    c.event(id, { type: "cancel" }); c.receive(supplement); await tick();
    expect(t.create).toHaveBeenCalledOnce();
    expect(t.edit.mock.calls.at(-1)?.[2]).toBe("已停止。");
  });
  it("does not bind unscoped or ambiguous events", async () => {
    const { controller: c, transport: t } = await setup();
    c.receive(inbound);
    c.receive({ ...inbound, route: { ...inbound.route, chatId: "456" } }); await tick(0);
    c.event(id, { type: "thinking" }, { bind: true });
    c.event({ runId: "unbound" }, { type: "finish", result: "failed" }); await tick();
    expect(t.edit).not.toHaveBeenCalled();
  });
  it("isolates account, chat, topic, session and run", async () => {
    const { controller: c, transport: t } = await setup();
    c.receive({ ...inbound, route: { ...inbound.route, accountId: "other" } });
    c.receive({ ...inbound, route: { ...inbound.route, chatId: "999" } });
    expect(t.create).not.toHaveBeenCalled();
    c.receive(inbound); await tick(0); c.event(id, { type: "thinking" }, { bind: true });
    c.event({ ...id, sessionKey: "other" }, { type: "cancel" });
    c.event({ ...id, route: { threadId: 7 } }, { type: "cancel" });
    c.event({ sessionKey: "s1", runId: "other" }, { type: "cancel" }); await tick();
    expect(t.edit.mock.calls.at(-1)?.[2]).toBe("正在思考…");
  });
  it("does not attach a late old run to a new sequential task", async () => {
    const { controller: c, transport: t } = await setup();
    c.receive(inbound); await tick(0); c.event(id, { type: "thinking" }, { bind: true });
    c.event(id, { type: "cancel" }); await tick();
    c.receive({ ...inbound, inboundId: "2" }); await tick();
    c.event(id, { type: "thinking" }, { bind: true, seq: 20 });
    c.event({ sessionKey: "s1", runId: "r2" }, { type: "thinking" }, { bind: true, seq: 1 }); await tick();
    expect(t.create).toHaveBeenCalledTimes(2);
    expect(t.edit.mock.calls.at(-1)?.[2]).toBe("正在思考…");
  });
  it("ignores duplicate/reordered sequences and all events after terminal", async () => {
    const { controller: c, transport: t } = await setup();
    c.receive(inbound); await tick(0); c.event(id, { type: "thinking" }, { bind: true, seq: 1 });
    c.event(id, { type: "tool_end", id: "a" }, { seq: 4 });
    c.event(id, { type: "tool_start", id: "a", search: true }, { seq: 2 });
    c.event(id, { type: "cancel" }, { seq: 5 });
    c.event(id, { type: "thinking" }, { seq: 6 }); await tick();
    expect(t.edit).toHaveBeenCalledExactlyOnceWith(inbound.route, 42, "已停止。");
  });
  it("cleans known orphan messages after restart without resending tasks", async () => {
    const { controller: c, transport: t } = await setup([{ ...inbound, id: "saved", phase: "tool", runId: "old", messageId: 11, createdAt: Date.now() - 1000, updatedAt: Date.now() - 500, sendState: "sent", settled: false }]);
    await tick();
    expect(t.create).not.toHaveBeenCalled();
    expect(t.edit.mock.calls[0]?.[1]).toBe(11);
    expect(t.edit.mock.calls[0]?.[2]).toContain("不再更新");
    c.event({ sessionKey: "s1", runId: "old" }, { type: "thinking" }); await tick();
    expect(t.edit).toHaveBeenCalledOnce();
  });
  it("does not replay a create with unknown outcome after restart", async () => {
    const { transport: t } = await setup([{ ...inbound, id: "saved", phase: "tool", createdAt: Date.now(), updatedAt: Date.now(), sendState: "attempted", settled: false }]);
    await tick(); expect(t.create).not.toHaveBeenCalled();
  });
  it("times out status tracking without pretending the native task was cancelled", async () => {
    const { controller: c, transport: t } = await setup(); c.receive(inbound); await tick(0);
    await tick(65000);
    expect(t.edit.mock.calls.at(-1)?.[2]).toContain("状态跟踪已结束");
    expect(t.edit.mock.calls.at(-1)?.[2]).not.toContain("已停止");
  });
  it("cleans up on disable and refuses new work", async () => {
    const { controller: c, transport: t } = await setup(); c.receive(inbound); await tick(0);
    const stopping = c.stop(); await tick(); await stopping;
    c.receive({ ...inbound, inboundId: "2" }); expect(t.create).toHaveBeenCalledOnce();
    expect(c.status().ready).toBe(false);
  });
  it("closes a proven successful media run when the native path omits message_sent", async () => {
    const { controller: c, transport: t } = await setup();
    c.receive(inbound); await tick(0); c.event(id, { type: "thinking" }, { bind: true });
    c.event(id, { type: "finish", result: "success" });
    await tick(4000); expect(t.delete).not.toHaveBeenCalled();
    await tick(6500); expect(t.delete).toHaveBeenCalledOnce();
    expect(c.status().active).toBe(0);
  });
  it("does not let the media grace window hide a confirmed delivery failure or stop", async () => {
    const { controller: c, transport: t } = await setup();
    c.receive(inbound); await tick(0); c.event(id, { type: "thinking" }, { bind: true });
    c.event(id, { type: "finish", result: "success" }); c.delivered(id, false); await tick(10000);
    expect(t.delete).not.toHaveBeenCalled(); expect(t.edit.mock.calls.at(-1)?.[2]).toContain("未能完成");
  });
});

describe("transport resilience", () => {
  it("does not blindly retry a send whose result is unknown", async () => {
    const { controller: c, transport: t } = await setup(); t.create.mockRejectedValue(new TransportError("uncertain"));
    c.receive(inbound); await tick(); c.event(id, { type: "thinking" }, { bind: true }); await tick(10000);
    expect(t.create).toHaveBeenCalledOnce(); expect(c.status().failures).toBe(1);
  });
  it("honors retry_after and merges updates during a rate limit", async () => {
    const { controller: c, transport: t } = await setup();
    t.edit.mockRejectedValueOnce(new TransportError("rate_limit", 6000));
    c.receive(inbound); await tick(0); c.event(id, { type: "thinking" }, { bind: true }); await tick(1500);
    c.event(id, { type: "cancel" }); await tick(5000); expect(t.edit).toHaveBeenCalledOnce();
    await tick(1500); expect(t.edit.mock.calls.at(-1)?.[2]).toBe("已停止。");
  });
  it("can retry a definitely rejected create after 429", async () => {
    const { controller: c, transport: t } = await setup(); t.create.mockRejectedValueOnce(new TransportError("rate_limit", 2000));
    c.receive(inbound); await tick(2500); expect(t.create).toHaveBeenCalledTimes(2);
  });
  it("retries proven pre-send connection failures without duplicating delivered messages", async () => {
    const { controller: c, transport: t } = await setup();
    t.create.mockRejectedValueOnce(new TransportError("connect_failed", 1000));
    c.receive(inbound); await tick(3500);
    expect(t.create).toHaveBeenCalledTimes(2);
    c.event(id, { type: "finish", result: "success" }, { bind: true }); c.delivered(id, true); await tick();
    expect(t.delete).toHaveBeenCalledOnce();
  });
  it("retries idempotent edits, but never recreates deleted messages", async () => {
    const { controller: c, transport: t } = await setup();
    c.receive(inbound); await tick(0); t.edit.mockRejectedValueOnce(new TransportError("uncertain"));
    c.event(id, { type: "thinking" }, { bind: true }); await tick(4000);
    expect(t.edit).toHaveBeenCalledTimes(2);
    t.edit.mockRejectedValueOnce(new TransportError("gone")); c.event(id, { type: "cancel" }); await tick();
    expect(t.create).toHaveBeenCalledOnce();
  });
  it("keeps logs and saved state free of payload content and credentials", async () => {
    const { controller: c, store, audit } = await setup();
    c.receive(inbound); await tick(0); c.event(id, { type: "tool_start", id: "safe-call-id", search: false }, { bind: true });
    const encoded = JSON.stringify({ state: store.data, audit: audit.mock.calls });
    expect(encoded).not.toMatch(/botToken|params|content|result|toolName/);
    expect(Object.keys(store.data[0]!)).toEqual(["id", "route", "sessionKey", "inboundId", "runId", "inboundIds", "messageId", "phase", "createdAt", "updatedAt", "sendState", "settled"]);
  });
});
