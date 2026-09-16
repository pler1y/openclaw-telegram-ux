import type { Phase, TaskState } from "../core/state.js";

export type Language = "zh" | "en";
export type ProgressStyle = "compact" | "detailed";
export interface Preferences { language: Language; progressStyle: ProgressStyle }
export const VERSION = "0.2.0-beta.1";
export const textOf = (language: Language, zh: string, en: string): string => language === "en" ? en : zh;

const labels: Record<Language, Record<Phase, string>> = {
  zh: {
    received: "收到，正在处理…", thinking: "正在思考…", searching: "正在搜索资料…", tool: "正在执行工具…",
    organizing: "正在整理结果…", approval: "正在等待你的批准。", compacting: "正在整理上下文…", background: "正在等待后台任务…",
    completed: "处理完成。", failed: "本次任务未能完成，请查看机器人回复。", cancelled: "已停止。",
    orphaned: "服务已重启或状态跟踪已结束。本次进度不再更新。", timeout: "等待时间较长，状态跟踪已结束。可使用 /status 查看任务。",
  },
  en: {
    received: "Received. Getting started…", thinking: "Thinking…", searching: "Searching for information…", tool: "Running tools…",
    organizing: "Preparing the result…", approval: "Waiting for your approval.", compacting: "Compacting the conversation…", background: "Waiting for background tasks…",
    completed: "Completed.", failed: "This task could not finish. Please check the bot's reply.", cancelled: "Stopped.",
    orphaned: "The service restarted or tracking ended. This progress message will no longer update.", timeout: "Progress tracking timed out. Use /status to check the task.",
  },
};
const terminal = new Set<Phase>(["completed", "failed", "cancelled", "orphaned", "timeout"]);

export function cleanProgress(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || Array.from(text).length > 160) return;
  // Progress is public-facing prose, not a place for keys, URLs or command dumps.
  if (/\b\d{8,12}:[\w-]{30,}|\b(?:sk-|gh[pousr]_)[\w-]{16,}|-----BEGIN|https?:\/\/|```/i.test(text)) return;
  return text;
}

export function render(s: TaskState, options?: Preferences & { elapsedMs?: number; idleMs?: number }): string | null {
  if (s.phase === "completed") return null;
  const language = options?.language ?? "zh";
  let text = labels[language][s.phase];
  const count = Object.keys(s.tools).length;
  if (count > 1 && (s.phase === "tool" || s.phase === "searching")) text += textOf(language, `（${count} 项）`, ` (${count} active)`);
  if (terminal.has(s.phase)) return text;
  if (options?.progressStyle === "detailed") {
    if (s.progressText && !s.ended && !["approval", "compacting"].includes(s.phase)) text += `\n${s.progressText}`;
    const children = Object.values(s.children);
    if (children.length) {
      const active = children.filter(v => v === "running").length;
      const unsuccessful = children.filter(v => v !== "running" && v !== "ok").length;
      text += textOf(language, `\n后台任务：${active} 项运行中，${children.length - active} 项已结束`, `\nBackground tasks: ${active} running, ${children.length - active} ended`);
      if (unsuccessful) text += textOf(language, `，${unsuccessful} 项未确认成功`, `; ${unsuccessful} not confirmed successful`);
    }
    const seconds = Math.floor((options.elapsedMs ?? 0) / 15_000) * 15;
    if (seconds >= 15) text += textOf(language, `\n已用时 ${seconds} 秒`, `\nElapsed: ${seconds}s`);
    if ((options.idleMs ?? 0) >= 30_000 && !["approval", "compacting"].includes(s.phase)) text += textOf(language, " · 暂未收到新进展", " · No new progress event yet");
  }
  if (s.supplemented) text += textOf(language, "\n补充已收到。", "\nYour additional message was received.");
  return text;
}

/** These whole-message phrases are already recognized by the pinned native host. */
export function isNativeStop(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").replace(/[.!?！？…,，。;；:：'"’”)\]}]+$/u, "");
  return new Set(["停止", "停下来", "暂停", "stop", "esc", "abort", "exit", "interrupt", "halt", "stop openclaw", "openclaw stop", "stop action", "stop current action", "stop run", "stop current run", "stop agent", "stop the agent", "stop don't do anything", "stop dont do anything", "stop do not do anything", "stop doing anything", "do not do that", "please stop", "stop please"]).has(normalized);
}
