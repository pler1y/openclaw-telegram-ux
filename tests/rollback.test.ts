import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.each([false, true])("restores only the selected account and plugin settings (baseline=%s)", async baseline => {
  const dir = await mkdtemp(join(tmpdir(), "tgux-rollback-"));
  try {
    const make = (mode: string, model: string, language?: string) => ({
      agents: { defaults: { model } },
      channels: { telegram: { streaming: { mode: "partial" }, accounts: { test: { streaming: { mode }, botToken: "fixture" }, other: { streaming: { mode: "block" } } } } },
      plugins: { entries: { "openclaw-telegram-ux": { enabled: true, config: { accountId: "test", ...(language && { language }) } }, unrelated: { enabled: true } } },
    });
    const before = make("partial", "old"), current = make("off", "user-new", "en");
    await writeFile(join(dir, "before.json"), JSON.stringify(before)); await writeFile(join(dir, "current.json"), JSON.stringify(current));
    execFileSync("python3", ["scripts/rollback.py", "--backup", join(dir, "before.json"), "--config", join(dir, "current.json"), ...(baseline ? ["--restore-plugin-config"] : [])]);
    const after = JSON.parse(await readFile(join(dir, "current.json"), "utf8"));
    expect(after.agents).toEqual(current.agents);
    expect(after.channels.telegram).toEqual(before.channels.telegram);
    expect(after.plugins.entries.unrelated).toEqual(current.plugins.entries.unrelated);
    expect(after.plugins.entries["openclaw-telegram-ux"].enabled).toBe(baseline);
    if (baseline) expect(after.plugins.entries["openclaw-telegram-ux"].config).toEqual(before.plugins.entries["openclaw-telegram-ux"].config);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
