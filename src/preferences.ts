import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Preferences } from "./presentation.js";
import type { Route } from "./telegram.js";

export class PreferenceStore {
  private values = new Map<string, Preferences>();
  private chain = Promise.resolve();
  constructor(private readonly dir: string, private readonly defaults: Preferences) {}
  private key(route: Route): string { return JSON.stringify([route.accountId, route.chatId]); }
  async load(): Promise<void> {
    try {
      const rows: unknown = JSON.parse(await readFile(join(this.dir, "preferences.json"), "utf8"));
      if (!Array.isArray(rows)) throw new Error("invalid");
      for (const row of rows.slice(-500)) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || !row[1] || typeof row[1] !== "object") continue;
        const p = row[1];
        if (["zh", "en"].includes(p.language) && ["compact", "detailed"].includes(p.progressStyle)) this.values.set(row[0], { language: p.language, progressStyle: p.progressStyle });
      }
    } catch (e) { if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw new Error("tgux_preferences_unavailable"); }
  }
  get(route: Route): Preferences { return { ...(this.values.get(this.key(route)) ?? this.defaults) }; }
  async set(route: Route, patch: Partial<Preferences>): Promise<void> {
    // Serialize reads as well as writes so overlapping language/style actions cannot lose a preference.
    const update = this.chain.then(async () => {
      const key = this.key(route);
      const next = new Map(this.values);
      next.set(key, { ...this.get(route), ...patch });
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await writeFile(join(this.dir, "preferences.json.tmp"), JSON.stringify([...next]), { mode: 0o600 });
      await rename(join(this.dir, "preferences.json.tmp"), join(this.dir, "preferences.json"));
      this.values = next;
    });
    this.chain = update.catch(() => {});
    await update.catch(() => { throw new Error("tgux_preferences_write_failed"); });
  }
}
