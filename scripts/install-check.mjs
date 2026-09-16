import { mkdtemp, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const isolate = await mkdtemp(join(tmpdir(), "tgux-install-"));
const cli = join(root, "node_modules/openclaw/dist/index.js");
const tempRoot = join(isolate, "tmp");
await mkdir(tempRoot, { mode: 0o700 });
const env = { ...process.env, TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot, OPENCLAW_STATE_DIR: isolate, OPENCLAW_CONFIG_PATH: join(isolate, "openclaw.json") };
function call(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { env, cwd: root, encoding: "utf8", timeout: args[1] === "install" ? 300000 : 60000 });
  if (r.status !== 0) throw new Error(`CLI ${args.slice(0, 2).join(" ")} failed (${r.error?.code ?? r.signal ?? r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const packagePath = resolve(process.argv[2] ?? join(root, "artifacts/openclaw-telegram-ux-0.1.0-beta.1.tgz"));
call(["plugins", "install", packagePath, "--force", "--accept-capabilities"]);
const config = JSON.parse(await readFile(env.OPENCLAW_CONFIG_PATH, "utf8"));
const entry = config.plugins.entries["openclaw-telegram-ux"];
if (entry.enabled !== false) throw new Error("Expected configure-before-enable install");
entry.config = { mode: "active", allowedChatIds: ["123"], expectedBotUsername: "fixture_bot" };
entry.hooks = { allowConversationAccess: true };
await writeFile(env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
call(["plugins", "enable", "openclaw-telegram-ux"]);
call(["config", "validate"]);
call(["plugins", "disable", "openclaw-telegram-ux"]);
call(["plugins", "uninstall", "openclaw-telegram-ux", "--force"]);
const after = JSON.parse(await readFile(env.OPENCLAW_CONFIG_PATH, "utf8"));
if (after.plugins?.entries?.["openclaw-telegram-ux"]?.enabled === true) throw new Error("Uninstall left an enabled plugin entry");
if (await stat(join(isolate, "extensions/openclaw-telegram-ux")).then(() => true).catch(() => false)) throw new Error("Uninstall left the installed package");
await mkdir(join(root, "artifacts"), { recursive: true });
const report = { at: new Date().toISOString(), openclaw: "2026.9.1", passed: ["archive_install", "configuration_gate", "enable", "config_validate", "disable", "uninstall"], isolation: "temporary state directory; no real credentials or Telegram requests" };
await writeFile(join(root, "artifacts/install-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
