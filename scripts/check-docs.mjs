import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith(".md") ? [path] : [];
  }));
  return nested.flat();
}

const files = ["README.md", "README.en.md", "CONTRIBUTING.md", "CHANGELOG.md", ".github/pull_request_template.md"]
  .map(name => resolve(root, name)).concat(await markdownFiles(resolve(root, "docs")));
const contents = new Map(await Promise.all(files.map(async path => [path, await readFile(path, "utf8")])));
const outsideCode = text => text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
function headingIds(text) {
  const ids = new Set(), counts = new Map();
  for (const match of outsideCode(text).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1].toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}_\-\s]/gu, "").trim().replace(/\s/g, "-");
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1); ids.add(count ? `${base}-${count}` : base);
  }
  return ids;
}
let checked = 0;
for (const [path, text] of contents) {
  for (const match of outsideCode(text).matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1];
    if (/^(?:[a-z]+:|\/\/)/i.test(href)) continue;
    const [name, fragment] = href.split("#");
    const target = name ? resolve(dirname(path), decodeURIComponent(name)) : path;
    assert(await stat(target).catch(() => null), `Missing link: ${path} -> ${href}`);
    if (fragment && extname(target) === ".md") {
      const body = contents.get(target) ?? await readFile(target, "utf8");
      assert(headingIds(body).has(decodeURIComponent(fragment)), `Missing heading: ${path} -> ${href}`);
    }
    checked++;
  }
  for (const match of text.matchAll(/`((?:src|tests|scripts|examples)\/[^`\s]+)`/g)) {
    assert(await stat(resolve(root, match[1])).catch(() => null), `Missing documented path: ${match[1]}`);
  }
  assert(!/\/(?:Users|home)\/[a-zA-Z0-9_.-]+\//.test(text), `Machine-specific path in ${path}`);
}
const example = JSON.parse(await readFile(resolve(root, "examples/openclaw.default.json"), "utf8"));
for (const name of ["README.md", "README.en.md"]) {
  const snippet = contents.get(resolve(root, name)).match(/```json\s*\n([\s\S]*?)\n```/);
  assert(snippet, `Missing quick-start configuration in ${name}`);
  assert.deepEqual(JSON.parse(snippet[1]), example, `Configuration drift in ${name}`);
}
for (const name of ["openclaw.default.json", "openclaw.named-account.json"]) {
  const data = JSON.parse(await readFile(resolve(root, "examples", name), "utf8"));
  const entry = data.plugins.entries["openclaw-telegram-ux"];
  assert.equal(entry.enabled, false);
  assert.equal(entry.hooks.allowConversationAccess, true);
  assert.deepEqual(entry.config.allowedChatIds, ["YOUR_PRIVATE_CHAT_ID"]);
  assert.equal(entry.config.expectedBotUsername, "YOUR_BOT_USERNAME");
  const telegram = data.channels.telegram;
  const account = entry.config.accountId ? telegram.accounts[entry.config.accountId] : telegram;
  assert.equal(account.streaming.mode, "off");
  assert(!JSON.stringify(data).includes('"botToken"'), `Credentials do not belong in ${name}`);
}
console.log(`Documentation: ${files.length} Markdown files, ${checked} local links, 2 shared configuration examples passed.`);
