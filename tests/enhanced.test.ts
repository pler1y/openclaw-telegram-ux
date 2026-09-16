import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../src/controller.js";
import { settingsOf } from "../src/config.js";
import { cleanProgress, isNativeStop, render } from "../src/presentation.js";
import { initialState, transition, type SemanticEvent } from "../src/state.js";
import type { StoredTask, TaskStore } from "../src/store.js";
import { TransportError } from "../src/telegram.js";

const settings = settingsOf({ allowedChatIds: ["123"], expectedBotUsername: "fixture_bot" });
const route = { accountId: "default", chatId: "123" };
const identity = { sessionKey: "s1", runId: "run1", route };
const inbound = { sessionKey: "s1", inboundId: "i1", route };
const state = (...events: SemanticEvent[]) => events.reduce(transition, initialState());
let current: Controller | undefined;
async function setup() {
  const data: { rows: StoredTask[] } = { rows: [] };
  const store: TaskStore = { load: async () => [], save: rows => { data.rows = structuredClone(rows); }, flush: async () => {} };
  const transport = { create: vi.fn().mockResolvedValue(10), edit: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
  const audit = vi.fn();
  current = new Controller(settings, transport, store, audit, () => ({ language: "en", progressStyle: "detailed" }));
  await current.start(); current.receive(inbound); await vi.advanceTimersByTimeAsync(0);
  current.event(identity, { type: "thinking" }, { bind: true });
  return { c: current, transport, audit, data };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
afterEach(async () => { const closing = current?.stop(); await vi.advanceTimersByTimeAsync(15_000); await closing; current = undefined; vi.useRealTimers(); });

describe("enhanced progress", () => {
  it("defaults old configurations to Chinese detailed mode", () => {
    expect(settings).toMatchObject({ language: "zh", progressStyle: "detailed" });
  });
  it("shows elapsed time without inventing progress or a percentage", () => {
    const s = state({ type: "thinking" }, { type: "progress", text: "Checking the source documents" });
    const text = render(s, { language: "en", progressStyle: "detailed", elapsedMs: 45_000, idleMs: 40_000 });
    expect(text).toContain("45s"); expect(text).toContain("No new progress event"); expect(text).not.toContain("%");
    expect(render(s, { language: "zh", progressStyle: "compact" })).toBe("正在思考…");
  });
  it("removes terminal progress details and localizes each state", () => {
    for (const event of [{ type: "cancel" }, { type: "orphan" }, { type: "timeout" }, { type: "finish", result: "failed" }] satisfies SemanticEvent[]) {
      const s = state({ type: "progress", text: "an old update" }, event);
      const rendered = render(s, { language: "en", progressStyle: "detailed" });
      expect(rendered).not.toMatch(/an old update|[\u4e00-\u9fff]/);
    }
  });
  it("rejects long, secret-shaped or raw diagnostic progress", () => {
    expect(cleanProgress("核对\n两个来源 ✅")).toBe("核对 两个来源 ✅");
    for (const v of ["x".repeat(161), "https://example.com/private", "```sh", "123456789:" + "a".repeat(40), {}, "\u200b"]) expect(cleanProgress(v)).toBeUndefined();
  });
  it.each(["停止", "停下来。", "暂停！", "stop please", "  STOP  "])("recognizes native whole-message stop: %s", value => expect(isNativeStop(value)).toBe(true));
  it.each(["请解释停止这个词", "“停止”是什么意思", "不要停止", "等一下", "停", "stop the database after backup"])("does not invent a stop trigger: %s", value => expect(isNativeStop(value)).toBe(false));
  it("keeps approval and compaction visible across overlapping tools", () => {
    let s = state({ type: "tool_start", id: "t", search: false }, { type: "compaction", active: true }, { type: "approval", waiting: true }, { type: "tool_end", id: "t" });
    expect(s.phase).toBe("approval"); s = transition(s, { type: "approval", waiting: false }); expect(s.phase).toBe("compacting");
    s = transition(s, { type: "compaction", active: false }); expect(s.phase).toBe("organizing");
  });
  it("accepts progress only from an already bound current tool call and never stores text", async () => {
    const { c, transport, audit, data } = await setup();
    expect(c.progressFromTool("call", identity, "private progress description")).toBe(false);
    c.trackProgressCall(identity, "call");
    expect(c.progressFromTool("call", { ...identity, route: { ...route, chatId: "999" } }, "wrong route")).toBe(false);
    expect(c.progressFromTool("call", identity, "private progress description")).toBe(true);
    expect(c.progressFromTool("call", identity, "duplicate")).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.edit.mock.calls.at(-1)?.[2]).toContain("private progress description");
    expect(JSON.stringify({ data, audit: audit.mock.calls })).not.toContain("private progress description");
  });
  it("rejects old and reused tool calls after stop and a new request", async () => {
    const { c } = await setup(); c.trackProgressCall(identity, "old"); c.event(identity, { type: "cancel" });
    c.receive({ ...inbound, inboundId: "i2" }); const next = { ...identity, runId: "run2" };
    c.event(next, { type: "thinking" }, { bind: true }); c.trackProgressCall(next, "old");
    expect(c.progressFromTool("old", identity, "late")).toBe(false);
    c.trackProgressCall(next, "fresh"); expect(c.progressFromTool("fresh", next, "new task")).toBe(true);
  });
  it("updates long-wait display without refreshing the actual activity timestamp", async () => {
    const { c, transport, data } = await setup(); const at = data.rows[0]!.updatedAt;
    await vi.advanceTimersByTimeAsync(46_000);
    expect(transport.edit.mock.calls.at(-1)?.[2]).toContain("No new progress event");
    expect(data.rows[0]!.updatedAt).toBe(at); expect(c.status().active).toBe(1);
  });
  it("honors menu rate limits for subsequent status messages in the same queue", async () => {
    const { c, transport } = await setup();
    const action = c.dispatch(route, async () => { throw new TransportError("rate_limit", 5000); }).catch(() => {});
    await vi.advanceTimersByTimeAsync(3000); await action;
    const count = transport.edit.mock.calls.length;
    c.event(identity, { type: "tool_start", id: "work", search: false });
    await vi.advanceTimersByTimeAsync(4000); expect(transport.edit).toHaveBeenCalledTimes(count);
    await vi.advanceTimersByTimeAsync(2000); expect(transport.edit.mock.calls.length).toBeGreaterThan(count);
  });
  it("waits for explicitly associated children after parent completion", async () => {
    const { c, transport } = await setup(); const child = { runId: "child", sessionKey: "child-session" };
    c.childStarted({ sessionKey: "s1", route, inboundId: "i1" }, child);
    c.event(identity, { type: "finish", result: "success" }); c.delivered(identity, true);
    await vi.advanceTimersByTimeAsync(10_000); expect(transport.delete).not.toHaveBeenCalled();
    expect(transport.edit.mock.calls.at(-1)?.[2]).toContain("Background tasks: 1 running");
    c.childEnded(child, "ok"); await vi.advanceTimersByTimeAsync(2000); c.childEnded(child, "ok");
    await vi.advanceTimersByTimeAsync(8000); expect(transport.delete).toHaveBeenCalledOnce();
    c.childStarted({ sessionKey: "s1", route }, { runId: "late", sessionKey: "late" }); expect(c.status().active).toBe(0);
  });
  it("does not associate a child from another inbound or route", async () => {
    const { c, transport } = await setup();
    c.childStarted({ sessionKey: "s1", route, inboundId: "other" }, { runId: "wrong", sessionKey: "child" });
    c.event(identity, { type: "finish", result: "success" }); c.delivered(identity, true);
    await vi.advanceTimersByTimeAsync(2000); expect(transport.delete).toHaveBeenCalledOnce();
  });
});
