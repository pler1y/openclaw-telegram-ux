import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

export interface Settings {
  mode: "probe" | "active";
  accountId: string;
  allowedChatIds: string[];
  expectedBotUsername: string;
  editIntervalMs: number;
  statusTimeoutMs: number;
  language?: "zh" | "en";
  progressStyle?: "compact" | "detailed";
}

export function settingsOf(value: Record<string, unknown> = {}): Settings {
  const chats = value.allowedChatIds;
  if (!Array.isArray(chats) || !chats.length || !chats.every(v => typeof v === "string" && /^[0-9]+$/.test(v))) throw new Error("tgux_invalid_chat_allowlist");
  if (typeof value.expectedBotUsername !== "string" || !/^[a-zA-Z0-9_]+$/.test(value.expectedBotUsername)) throw new Error("tgux_invalid_bot_username");
  return {
    mode: value.mode === "probe" ? "probe" : "active",
    accountId: typeof value.accountId === "string" ? value.accountId : "default",
    allowedChatIds: chats,
    expectedBotUsername: value.expectedBotUsername,
    editIntervalMs: Math.max(1_000, Number(value.editIntervalMs) || 1_500),
    statusTimeoutMs: Math.max(60_000, Number(value.statusTimeoutMs) || 1_800_000),
    language: value.language === "en" ? "en" : "zh",
    progressStyle: value.progressStyle === "compact" ? "compact" : "detailed",
  };
}

export function botTokenOf(api: OpenClawPluginApi, settings: Settings): string {
  const telegram = api.config.channels?.telegram;
  const account = settings.accountId === "default" ? telegram : telegram?.accounts?.[settings.accountId];
  const token = account?.botToken;
  if (typeof token !== "string" || !token.trim()) throw new Error("tgux_bot_token_unavailable");
  return token;
}

export function chatIdOf(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return;
  const match = String(value).match(/^(?:telegram:)?([0-9]+)$/);
  return match?.[1];
}
