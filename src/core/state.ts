export type Phase = "received" | "thinking" | "searching" | "tool" | "organizing" | "approval" | "compacting" | "background" | "completed" | "failed" | "cancelled" | "orphaned" | "timeout";
export type SemanticEvent =
  | { type: "thinking" }
  | { type: "tool_start"; id: string; search: boolean }
  | { type: "tool_end"; id: string }
  | { type: "organizing" }
  | { type: "approval"; waiting: boolean }
  | { type: "supplement" }
  | { type: "progress"; text: string }
  | { type: "compaction"; active: boolean }
  | { type: "child_start"; id: string }
  | { type: "child_end"; id: string; outcome: "ok" | "error" | "timeout" | "killed" | "unknown" }
  | { type: "finish"; result: "success" | "failed" | "cancelled" }
  | { type: "delivered"; final: boolean; success: boolean }
  | { type: "close_success" }
  | { type: "cancel" | "orphan" | "timeout" };

export interface TaskState {
  phase: Phase;
  tools: Record<string, boolean>;
  finishedTools: string[];
  hadTools: boolean;
  supplemented: boolean;
  ended: boolean;
  delivered: boolean;
  progressText?: string;
  compacting: boolean;
  waitingApproval: boolean;
  children: Record<string, "running" | "ok" | "error" | "timeout" | "killed" | "unknown">;
}

export function initialState(): TaskState {
  return { phase: "received", tools: {}, finishedTools: [], hadTools: false, supplemented: false, ended: false, delivered: false, compacting: false, waitingApproval: false, children: {} };
}

export function isTerminal(phase: Phase): boolean {
  return ["completed", "failed", "cancelled", "orphaned", "timeout"].includes(phase);
}

function toolPhase(s: TaskState): Phase {
  return s.waitingApproval ? "approval" : s.compacting ? "compacting" : s.ended && Object.values(s.children).includes("running") ? "background" : Object.values(s.tools).some(Boolean) ? "searching" : Object.keys(s.tools).length ? "tool" : s.hadTools || s.ended ? "organizing" : "thinking";
}

export function transition(previous: TaskState, event: SemanticEvent): TaskState {
  if (isTerminal(previous.phase)) return previous;
  const s: TaskState = { ...previous, tools: { ...previous.tools }, finishedTools: [...previous.finishedTools], children: { ...previous.children } };
  switch (event.type) {
    case "thinking": if (!s.ended && s.phase !== "approval") s.phase = toolPhase(s); break;
    case "tool_start":
      if (s.ended || s.finishedTools.includes(event.id)) break;
      s.tools[event.id] = event.search; s.hadTools = true; s.phase = toolPhase(s); break;
    case "tool_end":
      delete s.tools[event.id];
      if (!s.finishedTools.includes(event.id)) s.finishedTools.push(event.id);
      s.hadTools = true;
      if (!s.ended) s.phase = toolPhase(s);
      break;
    case "organizing": if (!Object.keys(s.tools).length && !s.waitingApproval && !s.compacting) s.phase = s.ended ? toolPhase(s) : "organizing"; break;
    case "approval": s.waitingApproval = event.waiting; s.phase = toolPhase(s); break;
    case "supplement": s.supplemented = true; break;
    case "progress": if (!s.ended) s.progressText = event.text; break;
    case "compaction": if (!s.ended) { s.compacting = event.active; s.phase = toolPhase(s); } break;
    case "child_start": if (!s.ended && !s.children[event.id]) s.children[event.id] = "running"; break;
    case "child_end":
      if (s.children[event.id] !== "running") break;
      s.children[event.id] = event.outcome;
      if (s.ended) { s.delivered = false; s.phase = toolPhase(s); }
      break;
    case "finish":
      s.ended = true;
      s.tools = {};
      s.compacting = false; s.waitingApproval = false;
      s.phase = event.result === "success" ? (Object.values(s.children).includes("running") ? "background" : s.delivered ? "completed" : "organizing") : event.result;
      break;
    case "delivered":
      // A commentary message is not evidence that the final answer was delivered.
      if (event.final && event.success) s.delivered = true;
      if (s.ended && s.delivered && !Object.values(s.children).includes("running")) s.phase = "completed";
      if (s.ended && event.final && !event.success) s.phase = "failed";
      break;
    case "close_success": if (s.ended && !Object.values(s.children).includes("running")) s.phase = "completed"; break;
    case "cancel": s.phase = "cancelled"; break;
    case "orphan": s.phase = "orphaned"; break;
    case "timeout": s.phase = "timeout"; break;
  }
  return s;
}

export { render } from "../telegram/presentation.js";
