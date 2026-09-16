export interface Route {
  accountId: string;
  chatId: string;
  threadId?: number;
}

export type Buttons = Array<Array<{ text: string; callback_data: string }>>;
export interface MessageTransport {
  create(route: Route, text: string, buttons?: Buttons): Promise<number>;
  edit(route: Route, messageId: number, text: string, buttons?: Buttons): Promise<void>;
  delete(route: Route, messageId: number): Promise<void>;
}

export class TransportError extends Error {
  constructor(
    readonly kind: "rate_limit" | "gone" | "unchanged" | "forbidden" | "connect_failed" | "uncertain" | "rejected",
    readonly retryAfterMs = 0,
    readonly networkCode?: string,
  ) {
    // Never expose the fetch error or request URL: the Telegram URL contains the token.
    super(`telegram_${kind}`);
  }
}

export class TelegramTransport implements MessageTransport {
  private readonly agent?: Agent;
  private readonly fetcher: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ json(): Promise<unknown> }>;
  constructor(private readonly token: string, fetcher?: typeof fetch) {
    if (fetcher) this.fetcher = fetcher;
    else {
      this.agent = new Agent({ connect: { timeout: 8_000, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 1_000 } });
      this.fetcher = (url, init) => request(url, { ...init, dispatcher: this.agent });
    }
  }

  async close(): Promise<void> { await this.agent?.close(); }

  private async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
    let body: { ok?: boolean; result?: unknown; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    try {
      const response = await this.fetcher(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      body = await response.json() as typeof body;
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
      const allowed = ["UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CLOSED", "UND_ERR_DESTROYED", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"];
      const safeCode = typeof code === "string" && allowed.includes(code) ? code : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? error.name : undefined;
      // Undici emits this from connection establishment, before any HTTP request
      // can be written. Only this proven pre-send failure is safe to retry for create.
      if (safeCode === "UND_ERR_CONNECT_TIMEOUT") throw new TransportError("connect_failed", 1_000, safeCode);
      throw new TransportError("uncertain", 0, safeCode);
    }
    if (body.ok) return body.result;
    if (body.error_code === 429) {
      throw new TransportError("rate_limit", Math.max(1, body.parameters?.retry_after ?? 5) * 1_000);
    }
    const description = body.description ?? "";
    if (/message is not modified/i.test(description)) throw new TransportError("unchanged");
    if (/message to (edit|delete) not found|message can't be (edited|deleted)/i.test(description)) throw new TransportError("gone");
    if (body.error_code === 401 || body.error_code === 403) throw new TransportError("forbidden");
    throw new TransportError("rejected");
  }

  async identity(): Promise<{ id: number; username: string }> {
    const result = await this.call("getMe", {});
    if (!result || typeof result !== "object" || !("id" in result) || !("username" in result)
      || typeof result.id !== "number" || typeof result.username !== "string") throw new TransportError("rejected");
    return { id: result.id, username: result.username };
  }

  async create(route: Route, text: string, buttons?: Buttons): Promise<number> {
    const result = await this.call("sendMessage", {
      chat_id: route.chatId, message_thread_id: route.threadId,
      text, disable_notification: true, link_preview_options: { is_disabled: true },
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
    if (!result || typeof result !== "object" || !("message_id" in result) || typeof result.message_id !== "number") {
      throw new TransportError("uncertain");
    }
    return result.message_id;
  }

  async edit(route: Route, messageId: number, text: string, buttons?: Buttons): Promise<void> {
    await this.call("editMessageText", { chat_id: route.chatId, message_id: messageId, text, link_preview_options: { is_disabled: true }, ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) });
  }

  async delete(route: Route, messageId: number): Promise<void> {
    await this.call("deleteMessage", { chat_id: route.chatId, message_id: messageId });
  }
}
import { Agent, fetch as request } from "undici";
