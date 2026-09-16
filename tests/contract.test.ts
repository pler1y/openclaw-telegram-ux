import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import entry from "../src/index.js";

function api(version = "2026.9.1", registrationMode = "full") {
  return {
    registrationMode, runtime: { version },
    config: { channels: { telegram: { botToken: "123:fixture" } } },
    pluginConfig: { allowedChatIds: ["123"], expectedBotUsername: "fixture_bot" },
    on: vi.fn(), registerService: vi.fn(), registerCommand: vi.fn(), registerHook: vi.fn(),
    registerTool: vi.fn(), registerInteractiveHandler: vi.fn(),
    agent: { events: { registerAgentEventSubscription: vi.fn() } },
    lifecycle: { registerRuntimeLifecycle: vi.fn() }, logger: { warn: vi.fn() },
  };
}
describe("exact OpenClaw public contract", () => {
  it("loads the official SDK and registers the fixed version's public hooks", async () => {
    const host = api(); await entry.register(host as unknown as OpenClawPluginApi);
    expect(host.on.mock.calls.map(c => c[0])).toEqual(["message_received", "model_call_started", "model_call_ended", "before_tool_call", "after_tool_call", "agent_end", "before_prompt_build", "before_compaction", "after_compaction", "subagent_spawned", "subagent_progress", "subagent_ended", "reply_payload_sending", "message_sent"]);
    expect(host.agent.events.registerAgentEventSubscription).toHaveBeenCalledOnce();
    expect(host.registerHook.mock.calls[0]?.[0]).toBe("command:stop");
    expect(host.lifecycle.registerRuntimeLifecycle).toHaveBeenCalledOnce();
    expect(host.registerTool.mock.calls[0]?.[1]).toEqual({ names: ["tgux_progress"] });
    expect(host.registerInteractiveHandler.mock.calls[0]?.[0]).toMatchObject({ channel: "telegram", namespace: "tgux" });
  });
  it("rejects unverified host versions before registering any side effect", () => {
    const host = api("2026.9.2");
    expect(() => entry.register(host as unknown as OpenClawPluginApi)).toThrow("tgux_unsupported_openclaw_version");
    expect(host.registerService).not.toHaveBeenCalled();
  });
  it.each(["discovery", "tool-discovery", "cli-metadata", "setup-only", "setup-runtime"])("does not perform runtime work during %s", mode => {
    const host = api("2026.9.1", mode);
    entry.register(host as unknown as OpenClawPluginApi);
    expect(host.registerService).not.toHaveBeenCalled();
    expect(host.on).not.toHaveBeenCalled();
    expect(host.registerInteractiveHandler).not.toHaveBeenCalled();
    expect(host.registerTool).toHaveBeenCalledTimes(["discovery", "tool-discovery"].includes(mode) ? 1 : 0);
  });
  it("imports only the documented narrow SDK entry and never starts a second receiver", async () => {
    const files = await readdir(new URL("../src/", import.meta.url));
    const sources = await Promise.all(files.filter(f => f.endsWith(".ts")).map(f => readFile(new URL(`../src/${f}`, import.meta.url), "utf8")));
    const code = sources.join("\n");
    const imports = [...code.matchAll(/from ["'](openclaw[^"']+)["']/g)].map(m => m[1]);
    expect(new Set(imports)).toEqual(new Set(["openclaw/plugin-sdk/plugin-entry"]));
    expect(code).not.toMatch(/getUpdates|setWebhook|runtime\.gateway|dist\/extensions|lifecycleGeneration/);
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const host = JSON.parse(await readFile(new URL("../node_modules/openclaw/package.json", import.meta.url), "utf8"));
    expect(packageJson.peerDependencies.openclaw).toBe("2026.9.1");
    expect(host.version).toBe("2026.9.1");
  });
});
