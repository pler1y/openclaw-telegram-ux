import { describe, expect, it } from "vitest";
import { initialState, render, transition, type SemanticEvent, type TaskState } from "../src/state.js";

const run = (...events: SemanticEvent[]) => events.reduce<TaskState>(transition, initialState());
describe("task state machine", () => {
  it("keeps concurrent tools active until every call finishes", () => {
    let s = run({ type: "tool_start", id: "a", search: true }, { type: "tool_start", id: "b", search: false }, { type: "tool_end", id: "a" });
    expect(s.phase).toBe("tool");
    s = transition(s, { type: "tool_end", id: "b" });
    expect(s.phase).toBe("organizing");
  });
  it("does not resurrect an ended tool from a duplicate or reordered start", () => {
    const s = run({ type: "tool_end", id: "a" }, { type: "tool_start", id: "a", search: true });
    expect(s.tools).toEqual({}); expect(s.phase).toBe("organizing");
  });
  it("waits for final delivery before deleting a completed status", () => {
    let s = run({ type: "delivered", final: false, success: true }, { type: "finish", result: "success" });
    expect(render(s)).not.toBeNull();
    s = transition(s, { type: "delivered", final: true, success: true });
    expect(render(s)).toBeNull();
  });
  it("supports final delivery before the completion event", () => {
    expect(run({ type: "delivered", final: true, success: true }, { type: "finish", result: "success" }).phase).toBe("completed");
  });
  it.each(["cancel", "orphan", "timeout"] as const)("%s is terminal and late events cannot reverse it", type => {
    const terminal = run({ type });
    for (const event of [{ type: "thinking" }, { type: "tool_start", id: "late", search: true }, { type: "finish", result: "success" }, { type: "delivered", final: true, success: true }] satisfies SemanticEvent[]) {
      expect(transition(terminal, event)).toBe(terminal);
    }
  });
  it("resolves stop/complete races by the first proven terminal state", () => {
    expect(run({ type: "cancel" }, { type: "finish", result: "success" }).phase).toBe("cancelled");
    expect(run({ type: "finish", result: "success" }, { type: "delivered", final: true, success: true }, { type: "cancel" }).phase).toBe("completed");
  });
  it("does not promise that a supplement was adopted", () => {
    const text = render(run({ type: "supplement" }, { type: "thinking" }));
    expect(text).toContain("补充已收到"); expect(text).not.toContain("已采纳");
  });
  it("keeps approval visible through model activity", () => {
    const s = run({ type: "approval", waiting: true }, { type: "thinking" });
    expect(s.phase).toBe("approval");
    expect(transition(s, { type: "approval", waiting: false }).phase).toBe("thinking");
  });
  it("distinguishes model failure and failed final delivery", () => {
    expect(run({ type: "finish", result: "failed" }).phase).toBe("failed");
    expect(run({ type: "finish", result: "success" }, { type: "delivered", final: true, success: false }).phase).toBe("failed");
  });
});
