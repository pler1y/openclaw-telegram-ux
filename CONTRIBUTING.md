# Contributing

Thanks for helping improve Telegram conversations in OpenClaw. Bug reports and feature requests are welcome in English or Chinese.

## Development setup

Use Node.js **24.16.0 or newer**, npm, and Python 3 for rollback tests. The lockfile pins the supported OpenClaw release.

```sh
git clone https://github.com/pler1y/openclaw-telegram-ux.git
cd openclaw-telegram-ux
npm ci --ignore-scripts
npm run check
```

Unit and contract tests use fake transports and fixture configuration. They do not connect to a Telegram bot. Installation checks may download package dependencies.

| Command | Purpose |
| --- | --- |
| `npm run docs:check` | Check documentation links and shared configuration examples |
| `npm run typecheck` | Check TypeScript and the exact public SDK contract |
| `npm test` | Run the automated regression suite |
| `npm run build` | Clean and rebuild generated JavaScript and build metadata |
| `npm run check` | Run all checks above |

## Repository layout

```text
src/
  index.ts                 Plugin entry point
  core/                    Task state, event correlation, update queue
  openclaw/                Public SDK adapters, settings, progress tool, probe
  telegram/                Bot API transport, rendering, menu interactions
  storage/                 Task persistence, preferences, metadata audit
tests/                     Unit, integration, and fixed-version contract tests
examples/                  Configuration fragments without credentials
docs/
  development/             Architecture, API evidence, release procedure
  releases/                Version-specific validation records
scripts/                   Build, validation, rollback, evidence export
.github/                   CI and contribution templates
```

`dist/` is generated. `artifacts/` holds local build products and private test evidence; both are ignored by Git. See the [architecture guide](docs/development/architecture.md) for the event flow.

## Scope of changes

Features must use third-party public OpenClaw APIs or the Telegram Bot API. Preserve native message reception, final delivery, steering, and stopping. Core patches, internal method replacement, and a second receiver are outside this project's scope.

Only update messages owned by the plugin. If an event cannot be reliably associated with a task, skip the update. Treat terminal states as final, and keep credentials, chat content, tool arguments, and tool results out of plugin logs.

A new OpenClaw compatibility claim needs public-contract, isolated-install, and live Telegram evidence. SDK compilation alone does not establish runtime support.

## Tests and pull requests

Run the checks relevant to the change. Documentation changes need `docs:check`; import layout and packaging changes also need a build and isolated install. State, routing, and interaction changes need regression tests for the affected behavior.

Describe the problem, the resulting behavior, and what was verified. State whether Telegram results came from a real chat or a controlled test. Update the Chinese and English README together when changing their shared instructions.

For an installable candidate and upgrade checks, follow the [release procedure](docs/development/releasing.md). Use a dedicated test bot and explicit operator authorization for live testing.

## Reporting an issue

Include the plugin version, OpenClaw version, operating system, steps to reproduce, and expected versus actual behavior. Remove credentials, private messages, chat IDs, and configuration secrets before sharing logs or screenshots.

Before proposing a feature, describe the Telegram experience you want to improve. A public API reference is useful when known, but is not required to report a need.
