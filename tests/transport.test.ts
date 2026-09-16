import { describe, expect, it, vi } from "vitest";
import { TelegramTransport, TransportError } from "../src/telegram/transport.js";

const route = { accountId: "default", chatId: "123" };
function response(body: unknown) { return new Response(JSON.stringify(body)); }

describe("Telegram official transport", () => {
  it("attaches controls only to plugin-owned messages through official markup", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({ ok: true, result: { message_id: 42 } }));
    const transport = new TelegramTransport("123:fixture", fetcher);
    const buttons = [[{ text: "帮助", callback_data: "tgux:fixture:help" }]];
    await transport.create(route, "菜单", buttons);
    await transport.edit(route, 42, "Menu", []);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).reply_markup).toEqual({ inline_keyboard: buttons });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ message_id: 42, reply_markup: { inline_keyboard: [] } });
  });
  it("uses one token only in the official URL and returns the owned message id", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ ok: true, result: { message_id: 42 } }));
    const transport = new TelegramTransport("123:fixture", fetcher);
    expect(await transport.create(route, "收到，正在处理…")).toBe(42);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bot123:fixture/sendMessage");
    expect(JSON.parse(String(options?.body))).toEqual({ chat_id: "123", text: "收到，正在处理…", disable_notification: true, link_preview_options: { is_disabled: true } });
  });
  it("does not retry an uncertain create or expose credentials in errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("https://api.telegram.org/bot123:fixture/sendMessage"));
    const transport = new TelegramTransport("123:fixture", fetcher);
    await expect(transport.create(route, "private body")).rejects.toEqual(new TransportError("uncertain"));
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    [429, "Too Many Requests", "rate_limit", 3_000],
    [400, "Bad Request: message is not modified", "unchanged", 0],
    [400, "Bad Request: message to edit not found", "gone", 0],
    [403, "Forbidden", "forbidden", 0],
    [500, "Internal error", "rejected", 0],
  ])("maps Telegram response %s/%s to a bounded error", async (code, description, kind, delay) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ ok: false, error_code: code, description, parameters: { retry_after: 3 } }));
    await expect(new TelegramTransport("123:fixture", fetcher).edit(route, 42, "正在思考…")).rejects.toMatchObject({ kind, retryAfterMs: delay });
  });
  it("rejects success responses without a message id as uncertain", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ ok: true, result: {} }));
    await expect(new TelegramTransport("123:fixture", fetcher).create(route, "test")).rejects.toMatchObject({ kind: "uncertain" });
  });
  it("retains only a bounded network error code, not raw diagnostic content", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret URL", { cause: { code: "UND_ERR_SOCKET", message: "private detail" } }));
    await expect(new TelegramTransport("123:fixture", fetcher).create(route, "body")).rejects.toMatchObject({ kind: "uncertain", networkCode: "UND_ERR_SOCKET", message: "telegram_uncertain" });
  });
  it("distinguishes connection establishment failure from an uncertain submitted request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }));
    await expect(new TelegramTransport("123:fixture", fetcher).create(route, "body")).rejects.toMatchObject({ kind: "connect_failed", retryAfterMs: 1000 });
  });
});
