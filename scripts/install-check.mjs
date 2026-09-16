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
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const packagePath = resolve(process.argv[2] ?? join(root, `artifacts/openclaw-telegram-ux-${pkg.version}.tgz`));
const baseline = process.argv[3] && resolve(process.argv[3]);
const passed = [];
const install = spec => call(["plugins", "install", spec, "--force", "--accept-capabilities"]);
install(`npm-pack:${packagePath}`);
passed.push("managed_npm_pack_install");
const config = JSON.parse(await readFile(env.OPENCLAW_CONFIG_PATH, "utf8"));
const entry = config.plugins.entries["openclaw-telegram-ux"];
if (entry.enabled !== false) throw new Error("Expected configure-before-enable install");
passed.push("configuration_gate");
entry.config = { mode: "active", allowedChatIds: ["123"], expectedBotUsername: "fixture_bot" };
entry.hooks = { allowConversationAccess: true };
await writeFile(env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
call(["plugins", "enable", "openclaw-telegram-ux"]);
call(["config", "validate"]);
passed.push("enable", "config_validate");
if (baseline) {
  call(["plugins", "disable", "openclaw-telegram-ux"]);
  install(baseline);
  call(["plugins", "enable", "openclaw-telegram-ux"]);
  call(["config", "validate"]);
  passed.push("baseline_rollback");
  install(`npm-pack:${packagePath}`);
  call(["plugins", "enable", "openclaw-telegram-ux"]);
  call(["config", "validate"]);
  const upgraded = JSON.parse(await readFile(env.OPENCLAW_CONFIG_PATH, "utf8"));
  if (JSON.stringify(upgraded.plugins.entries["openclaw-telegram-ux"].config) !== JSON.stringify(entry.config)) throw new Error("Upgrade changed plugin preferences");
  passed.push("baseline_to_enhanced_upgrade", "legacy_config_preserved");
}
call(["plugins", "disable", "openclaw-telegram-ux"]);
call(["plugins", "uninstall", "openclaw-telegram-ux", "--force"]);
const after = JSON.parse(await readFile(env.OPENCLAW_CONFIG_PATH, "utf8"));
if (after.plugins?.entries?.["openclaw-telegram-ux"]?.enabled === true) throw new Error("Uninstall left an enabled plugin entry");
if (await stat(join(isolate, "extensions/openclaw-telegram-ux")).then(() => true).catch(() => false)) throw new Error("Uninstall left the installed package");
await mkdir(join(root, "artifacts"), { recursive: true });
passed.push("disable", "uninstall");
const report = { at: new Date().toISOString(), version: pkg.version, openclaw: "2026.9.1", passed, isolation: "temporary state directory; no real credentials or Telegram requests" };
await writeFile(join(root, "artifacts/install-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
