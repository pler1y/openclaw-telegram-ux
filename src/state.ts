export type Phase = "received" | "thinking" | "searching" | "tool" | "organizing" | "approval" | "completed" | "failed" | "cancelled" | "orphaned" | "timeout";
export type SemanticEvent =
  | { type: "thinking" }
  | { type: "tool_start"; id: string; search: boolean }
  | { type: "tool_end"; id: string }
  | { type: "organizing" }
  | { type: "approval"; waiting: boolean }
  | { type: "supplement" }
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
}

export function initialState(): TaskState {
  return { phase: "received", tools: {}, finishedTools: [], hadTools: false, supplemented: false, ended: false, delivered: false };
}

export function isTerminal(phase: Phase): boolean {
  return ["completed", "failed", "cancelled", "orphaned", "timeout"].includes(phase);
}

function toolPhase(s: TaskState): Phase {
  return Object.values(s.tools).some(Boolean) ? "searching" : Object.keys(s.tools).length ? "tool" : s.hadTools ? "organizing" : "thinking";
}

export function transition(previous: TaskState, event: SemanticEvent): TaskState {
  if (isTerminal(previous.phase)) return previous;
  const s: TaskState = { ...previous, tools: { ...previous.tools }, finishedTools: [...previous.finishedTools] };
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
    case "organizing": if (!Object.keys(s.tools).length) s.phase = "organizing"; break;
    case "approval": s.phase = event.waiting ? "approval" : toolPhase(s); break;
    case "supplement": s.supplemented = true; break;
    case "finish":
      s.ended = true;
      s.tools = {};
      s.phase = event.result === "success" ? (s.delivered ? "completed" : "organizing") : event.result;
      break;
    case "delivered":
      // A commentary message is not evidence that the final answer was delivered.
      if (event.final && event.success) s.delivered = true;
      if (s.ended && s.delivered) s.phase = "completed";
      if (s.ended && event.final && !event.success) s.phase = "failed";
      break;
    case "close_success": if (s.ended) s.phase = "completed"; break;
    case "cancel": s.phase = "cancelled"; break;
    case "orphan": s.phase = "orphaned"; break;
    case "timeout": s.phase = "timeout"; break;
  }
  return s;
}

const LABELS: Record<Phase, string> = {
  received: "收到，正在处理…",
  thinking: "正在思考…",
  searching: "正在搜索资料…",
  tool: "正在执行工具…",
  organizing: "正在整理结果…",
  approval: "正在等待你的批准。",
  completed: "处理完成。",
  failed: "本次任务未能完成，请查看机器人回复。",
  cancelled: "已停止。",
  orphaned: "服务已重启或状态跟踪已结束。本次进度不再更新。",
  timeout: "等待时间较长，状态跟踪已结束。可使用 /status 查看任务。",
};

export function render(s: TaskState): string | null {
  if (s.phase === "completed") return null;
  const extra = s.supplemented && !isTerminal(s.phase) ? "\n补充已收到。" : "";
  const count = Object.keys(s.tools).length;
  return LABELS[s.phase] + (count > 1 && (s.phase === "tool" || s.phase === "searching") ? `（${count} 项）` : "") + extra;
}
