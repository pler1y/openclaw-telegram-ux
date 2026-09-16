import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { settingsOf } from "./openclaw/config.js";
import { registerProbe } from "./openclaw/probe.js";
import { registerAdapter } from "./openclaw/adapter.js";
import { registerProgressTool } from "./openclaw/progress-tool.js";

export default definePluginEntry({
  id: "openclaw-telegram-ux",
  name: "OpenClaw Telegram UX",
  description: "中文即时回执与任务进度",
  register(api) {
    if (!["full", "discovery", "tool-discovery"].includes(api.registrationMode)) return;
    if (api.runtime.version !== "2026.9.1") throw new Error("tgux_unsupported_openclaw_version");
    const settings = settingsOf(api.pluginConfig);
    if (api.registrationMode !== "full") {
      if (settings.mode === "active") registerProgressTool(api, settings, () => undefined);
      return;
    }
    if (settings.mode === "probe") registerProbe(api, settings);
    else registerAdapter(api, settings);
  },
});
