import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { registerProgressTool } from "../src/progress-tool.js";
import { settingsOf } from "../src/config.js";
import type { Controller } from "../src/controller.js";

type Registration = Parameters<OpenClawPluginApi["registerTool"]>[0];
type Factory = Extract<Registration, (...args: never[]) => unknown>;
const settings = settingsOf({ allowedChatIds: ["123"], expectedBotUsername: "fixture_bot" });
function setup(available = true) {
  let factory!: Factory;
  const registerTool = vi.fn((candidate: Registration) => { if (typeof candidate === "function") factory = candidate; });
  const progressFromTool = vi.fn().mockReturnValue(true);
  registerProgressTool({ registerTool } as unknown as OpenClawPluginApi, settings, () => available ? { progressFromTool } as unknown as Controller : undefined);
  return { factory, registerTool, progressFromTool };
}
const context = { messageChannel: "telegram", agentAccountId: "default", nativeChannelId: "123", sessionKey: "s1" };
function one(factory: Factory) {
  const tool = factory(context);
  if (!tool || Array.isArray(tool)) throw new Error("missing tool");
  return tool;
}
describe("public progress tool", () => {
  it("uses trusted host routing even if forged arguments contain another chat", async () => {
    const { factory, progressFromTool } = setup();
    const result = await one(factory).execute("call1", { text: "核对来源", chatId: "456", sessionKey: "other" });
    expect(progressFromTool).toHaveBeenCalledWith("call1", { sessionKey: "s1", route: { accountId: "default", chatId: "123" } }, "核对来源");
    expect(result.details).toEqual({ updated: true });
  });
  it("is absent outside the permitted route or without a session", () => {
    const { factory } = setup();
    for (const ctx of [{ ...context, messageChannel: "discord" }, { ...context, nativeChannelId: "456" }, { ...context, agentAccountId: "other" }, { ...context, sessionKey: undefined }]) expect(factory(ctx)).toBeNull();
  });
  it("discovers without a running service and lets native work continue when unavailable", async () => {
    const { factory, registerTool } = setup(false);
    expect(registerTool.mock.calls[0]?.[0]).toBeTypeOf("function");
    expect((await one(factory).execute("call1", { text: "Checking sources" })).details).toEqual({ updated: false });
  });
  it("does not update an aborted tool call", async () => {
    const { factory, progressFromTool } = setup();
    expect((await one(factory).execute("call1", { text: "核对来源" }, AbortSignal.abort())).details).toEqual({ updated: false });
    expect(progressFromTool).not.toHaveBeenCalled();
  });
});
