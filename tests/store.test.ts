import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonTaskStore, type StoredTask } from "../src/store.js";

const record: StoredTask = { id: "fixture", route: { accountId: "default", chatId: "123" }, sessionKey: "s1", inboundId: "2", phase: "thinking", createdAt: 1, updatedAt: 2, sendState: "sent", messageId: 9, settled: false };
describe("minimal persistent state", () => {
  it("persists the newest snapshot atomically with private permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tgux-store-")); const store = new JsonTaskStore(dir);
    expect(await store.load()).toEqual([]);
    store.save([record]); store.save([{ ...record, phase: "cancelled" }]); await store.flush();
    expect((await store.load())[0]?.phase).toBe("cancelled");
    expect((await stat(join(dir, "state.json"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(dir, "state.json"), "utf8")).not.toMatch(/content|token|params|result/);
  });
  it("fails closed on corrupt state and strips undeclared loaded fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tgux-store-")); const file = join(dir, "state.json"); const store = new JsonTaskStore(dir);
    await writeFile(file, "broken"); await expect(store.load()).rejects.toThrow("tgux_state_unavailable");
    await writeFile(file, JSON.stringify([{ ...record, content: "discarded body", botToken: "discarded fixture" }, { bad: true }]));
    const loaded = await store.load(); expect(loaded).toHaveLength(1);
    expect(JSON.stringify(loaded)).not.toMatch(/discarded|content|botToken/);
  });
});
