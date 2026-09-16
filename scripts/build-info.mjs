import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
let commit = null;
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch {}
await writeFile(new URL("../dist/build-info.json", import.meta.url), JSON.stringify({
  version: pkg.version, openclawVersion: "2026.9.1",
  repository: "https://github.com/pler1y/openclaw-telegram-ux", sourceCommit: commit,
}, null, 2) + "\n");
