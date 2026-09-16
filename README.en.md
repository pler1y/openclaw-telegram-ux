# OpenClaw Telegram UX

**Receipts, useful progress, and clear completion states for long-running Telegram tasks.**

[中文](README.md) · English

[![CI](https://github.com/pler1y/openclaw-telegram-ux/actions/workflows/check.yml/badge.svg)](https://github.com/pler1y/openclaw-telegram-ux/actions/workflows/check.yml)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.9.1-blue)](docs/compatibility.md)
[![MIT License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

OpenClaw Telegram UX is a community plugin for Telegram private chats. It acknowledges requests and updates a single status message as work proceeds. Successful tasks remove that message; OpenClaw delivers the answer and attachments as usual.

[Download](https://github.com/pler1y/openclaw-telegram-ux/releases/tag/v0.2.0-beta.1) · [Documentation (中文)](docs/README.md) · [Report an issue](https://github.com/pler1y/openclaw-telegram-ux/issues)

## What it looks like

An example status message in detailed mode:

```text
Searching for information…
Checking three sources
Elapsed: 30s
```

- **Immediate acknowledgement** for ordinary requests and additional instructions sent during a task.
- **One progress message** for thinking, searching, tool execution, and preparation, with optional short activity updates from the current model.
- **Chinese and English**, compact and detailed views, elapsed time, and an honest indication when no new progress event has arrived.
- **Clear outcomes**: success removes the status message; cancellation, failure, and restart leave a brief explanation.
- **Native delivery** for answers, Markdown, citations, attachments, and stopping.

The plugin uses the public OpenClaw SDK and Telegram Bot API. It installs independently and requires no OpenClaw core changes.

## Quick start

Current release: **0.2.0-beta.1**. Requires **OpenClaw 2026.9.1**, **Node.js ≥ 24.16.0**, a working Telegram bot, and an already authorized private chat. Other OpenClaw versions are not supported yet.

### 1. Download and install

Download `openclaw-telegram-ux-0.2.0-beta.1.tgz` and `SHA256SUMS` from the [release page](https://github.com/pler1y/openclaw-telegram-ux/releases/tag/v0.2.0-beta.1). Wait for active tasks to finish, back up your configuration, and check the archive checksum.

```sh
openclaw plugins install npm-pack:./openclaw-telegram-ux-0.2.0-beta.1.tgz --accept-capabilities
```

### 2. Configure your private chat

Merge this fragment into your existing OpenClaw configuration, keeping existing fields. Replace the two placeholders: use the numeric sender ID returned by the native `/whoami` command in a private chat, and your bot username without `@`.

```json
{
  "channels": {
    "telegram": {
      "streaming": { "mode": "off" }
    }
  },
  "plugins": {
    "entries": {
      "openclaw-telegram-ux": {
        "enabled": false,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "allowedChatIds": ["YOUR_PRIVATE_CHAT_ID"],
          "expectedBotUsername": "YOUR_BOT_USERNAME"
        }
      }
    }
  }
}
```

This example uses the default Telegram account. Credentials come from the host's runtime `botToken` string; the plugin does not independently resolve environment variables, token files, or secret references. Named-account examples and all settings are in the [configuration reference (中文)](docs/configuration.md).

### 3. Enable and verify

```sh
openclaw plugins enable openclaw-telegram-ux
openclaw config validate
openclaw gateway restart
```

Send `/tgux` in the configured chat, then send an ordinary request. The interface defaults to Chinese; send `/tgux lang en` to switch to English. For Docker or another supervisor, restart the service using your usual deployment method.

## Everyday commands

| Action | Command |
| --- | --- |
| Status | `/tgux` |
| Help | `/tgux help` |
| Interface language | `/tgux lang zh` or `/tgux lang en` |
| Display style | `/tgux style compact` or `/tgux style detailed` |
| Stop the current task | Native `/stop` or a whole-message native stop phrase such as `stop` |

Interface language does not change the answer's language. Elapsed time measures waiting, not percentage complete. Additional instructions are acknowledged as received; the plugin does not claim that they have been adopted.

## Beta scope

Live validation currently covers OpenClaw 2026.9.1, xai/grok-4.6, and one authorized private chat.

Menu rendering and setting commands have been tested live. Button callbacks and follow-up submission still need live acceptance. Compaction and background-task adapters have automated coverage, but the tested model path did not emit their public events. Specific activity descriptions are optional model tool calls; event-based phases remain available when the model does not provide one.

The release includes [validation evidence (中文)](docs/releases/0.2.0-beta.1-validation.md). See [compatibility (中文)](docs/compatibility.md) for the full support boundary.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and checks. The [architecture guide](docs/development/architecture.md) explains the task core, OpenClaw adapter, Telegram presentation, and storage modules.

Licensed under [MIT](LICENSE). Independently maintained as a community project. Packages are distributed through GitHub Releases; the [publishing record (中文)](docs/releases/0.2.0-beta.1-publishing.md) tracks ClawHub preparation.
