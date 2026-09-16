import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";

export type Evidence = {
  event: string; at?: number; sessionKey?: string; runId?: string;
  chatId?: string; accountId?: string; threadId?: number; inboundId?: string; messageId?: number;
  phase?: string; success?: boolean; kind?: string; keys?: string[];
};

export class Audit {
  private chain = Promise.resolve();
  constructor(private readonly dir: string) {}
  write(evidence: Evidence): void {
    const line = JSON.stringify({ at: Date.now(), ...evidence }) + "\n";
    this.chain = this.chain.then(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const file = join(this.dir, "events.jsonl");
      const size = await stat(file).then(s => s.size).catch(() => 0);
      if (size > 1_048_576) await rename(file, join(this.dir, "events.previous.jsonl"));
      await appendFile(file, line, { mode: 0o600 });
    }).catch(() => { /* Evidence storage cannot interrupt the host. */ });
  }
  flush(): Promise<void> { return this.chain; }
}
