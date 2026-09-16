import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Phase } from "./state.js";
import type { Route } from "./telegram.js";

export interface StoredTask {
  id: string; route: Route; sessionKey: string; inboundId: string; runId?: string;
  inboundIds?: string[];
  messageId?: number; phase: Phase; createdAt: number; updatedAt: number;
  sendState: "new" | "attempted" | "sent" | "muted";
  settled: boolean;
}

export interface TaskStore {
  load(): Promise<StoredTask[]>;
  save(tasks: StoredTask[]): void;
  flush(): Promise<void>;
}

export class JsonTaskStore implements TaskStore {
  private chain = Promise.resolve();
  private failure: Error | undefined;
  constructor(private readonly dir: string) {}
  async load(): Promise<StoredTask[]> {
    try {
      const value: unknown = JSON.parse(await readFile(join(this.dir, "state.json"), "utf8"));
      if (!Array.isArray(value)) throw new Error("tgux_invalid_state");
      return value.slice(-500).flatMap((r: Partial<StoredTask>) => {
        if (!r || typeof r.id !== "string" || typeof r.sessionKey !== "string" || typeof r.inboundId !== "string"
          || !r.route || typeof r.route.accountId !== "string" || !/^[0-9]+$/.test(r.route.chatId)
          || !Number.isFinite(r.createdAt) || !Number.isFinite(r.updatedAt)
          || !["new", "attempted", "sent", "muted"].includes(r.sendState ?? "")
          || !["received", "thinking", "searching", "tool", "organizing", "approval", "compacting", "background", "completed", "failed", "cancelled", "orphaned", "timeout"].includes(r.phase ?? "")) return [];
        return [{
          id: r.id, route: { accountId: r.route.accountId, chatId: r.route.chatId,
            threadId: Number.isSafeInteger(r.route.threadId) && r.route.threadId! > 0 ? r.route.threadId : undefined },
          sessionKey: r.sessionKey, inboundId: r.inboundId, runId: typeof r.runId === "string" ? r.runId : undefined,
          inboundIds: Array.isArray(r.inboundIds) ? r.inboundIds.filter(v => typeof v === "string").slice(-128) : undefined,
          messageId: Number.isSafeInteger(r.messageId) && r.messageId! > 0 ? r.messageId : undefined,
          phase: r.phase!, createdAt: r.createdAt!, updatedAt: r.updatedAt!, sendState: r.sendState!, settled: r.settled === true,
        }];
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw new Error("tgux_state_unavailable");
    }
  }
  save(tasks: StoredTask[]): void {
    const snapshot = JSON.stringify(tasks);
    this.chain = this.chain.then(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const temp = join(this.dir, "state.json.tmp");
      await writeFile(temp, snapshot, { mode: 0o600 });
      await rename(temp, join(this.dir, "state.json"));
      this.failure = undefined;
    }).catch(() => { this.failure = new Error("tgux_state_write_failed"); });
  }
  async flush(): Promise<void> { await this.chain; if (this.failure) throw this.failure; }
}
