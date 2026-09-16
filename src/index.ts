import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { settingsOf } from "./config.js";
import { registerProbe } from "./probe.js";
import { registerAdapter } from "./adapter.js";

export default definePluginEntry({
  id: "openclaw-telegram-ux",
  name: "OpenClaw Telegram UX",
  description: "中文即时回执与任务进度",
  register(api) {
    if (api.registrationMode !== "full") return;
    if (api.runtime.version !== "2026.9.1") throw new Error("tgux_unsupported_openclaw_version");
    const settings = settingsOf(api.pluginConfig);
    if (settings.mode === "probe") registerProbe(api, settings);
    else registerAdapter(api, settings);
  },
});
