import { Type } from "typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { chatIdOf, type Settings } from "./config.js";
import type { Controller } from "../core/controller.js";
import { textOf, type Preferences } from "../telegram/presentation.js";
import type { Route } from "../telegram/transport.js";

export const PROGRESS_TOOL = "tgux_progress";

export function registerProgressTool(api: OpenClawPluginApi, settings: Settings, current: () => Controller | undefined, preferences?: (route: Route) => Preferences): void {
  api.registerTool(ctx => {
    const channel = ctx.messageChannel ?? ctx.deliveryContext?.channel;
    const accountId = ctx.agentAccountId ?? ctx.deliveryContext?.accountId ?? "default";
    const chatId = chatIdOf(ctx.nativeChannelId) ?? chatIdOf(ctx.deliveryContext?.to);
    if (channel !== "telegram" || accountId !== settings.accountId || !chatId || !settings.allowedChatIds.includes(chatId) || !ctx.sessionKey) return null;
    const route = { accountId, chatId };
    const language = preferences?.(route).language ?? settings.language ?? "zh";
    return {
      name: PROGRESS_TOOL,
      label: textOf(language, "更新任务进度", "Update task progress"),
      description: textOf(language,
        "在多步骤任务开始工作、切换阶段或取得重要结果时，简短说明当前实际在做什么（160 字以内）。只更新当前 Telegram 任务的进度气泡。简单问答无需调用。不要包含内部思考、凭据、URL、命令或工具结果，不要声称工作已完成或补充已采纳。无需为每个工具重复调用。",
        "During multi-step work, briefly describe the actual activity at the start, a phase change, or a meaningful milestone (max 160 characters). Updates this Telegram task's progress bubble. Skip for simple questions. Never include reasoning, credentials, URLs, commands, tool output, or claims of completion or steering adoption. Do not call for every tool."),
      parameters: Type.Object({ text: Type.String({ minLength: 1, maxLength: 160, description: textOf(language, "面向用户的中文工作进度短句", "A brief user-facing progress update in English") }) }, { additionalProperties: false }),
      async execute(toolCallId, params, signal) {
        const value = params && typeof params === "object" && "text" in params ? params.text : undefined;
        const updated = !signal?.aborted && current()?.progressFromTool(toolCallId, { sessionKey: ctx.sessionKey, route }, value) === true;
        return { content: [{ type: "text", text: updated ? textOf(language, "进度已更新。", "Progress updated.") : textOf(language, "进度显示暂不可用；请正常继续任务，无需重试这条更新。", "Progress display unavailable; continue the task normally without retrying this update.") }], details: { updated } };
      },
    };
  }, { names: [PROGRESS_TOOL] });
}
