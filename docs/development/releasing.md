# Release procedure

[Contributing](../../CONTRIBUTING.md) · [Version records](../README.md#对照与版本证据)

## Prepare the version

Update `package.json`, its lockfile, `openclaw.plugin.json`, and the display version in `src/telegram/presentation.ts` together. Keep the OpenClaw compatibility declaration restricted to verified versions.

Update both README files, the changelog, and relevant guides. Record live acceptance separately from controlled tests. Published tags, archives, checksums, and evidence belong to their original releases; use a new version for a new distributed package.

Development progress and private deployment details belong in ignored local artifacts. They are not part of public product documentation.

## Check source and build

```sh
npm ci --ignore-scripts
npm run check
mkdir -p artifacts/check
npm pack --pack-destination artifacts/check
```

Builds remove old `dist/` files before compiling. The package includes compiled code, the manifest, public documentation, configuration examples, and the rollback script. Source tests, dependencies, private logs, and local backups are excluded.

Check `dist/build-info.json` against the clean Git commit being released. The release package should be built again after the final commit, rather than reusing a package created from a dirty working tree.

## Check installation and rollback

Use the generated archive as the first argument. Supplying a baseline archive also exercises rollback and upgrade:

```sh
TGUX_ARTIFACTS_DIR=artifacts/check node scripts/install-check.mjs \
  artifacts/check/openclaw-telegram-ux-0.2.0-beta.1.tgz \
  artifacts/openclaw-telegram-ux-0.1.0-beta.1.tgz
```

Replace filenames for the target release. The script uses a temporary OpenClaw state directory, validates the shipped configuration examples, and checks install, enable, configuration, disable, and uninstall. It does not start the production Gateway or call Telegram.

The baseline can be downloaded from its immutable [release page](https://github.com/pler1y/openclaw-telegram-ux/releases/tag/v0.1.0-beta.1). Check its published checksum before use.

## Run official plugin checks

The currently verified inspector is `clawhub@0.23.3`:

```sh
npm exec --yes --package=clawhub@0.23.3 -- clawhub package validate . \
  --out artifacts/check/inspector --openclaw node_modules/openclaw
```

Default static inspection is not live execution coverage. For a release candidate, run the official publish preview with the intended source ref:

```sh
npm exec --yes --package=clawhub@0.23.3 -- clawhub package publish . \
  --family code-plugin --dry-run \
  --source-repo pler1y/openclaw-telegram-ux \
  --source-ref main --json
```

For the final publication, use the actual tag or immutable source commit. Confirm publisher identity, package name/scope, and runtime-ID ownership before a real ClawHub submission. Local checks do not guarantee that server-side security checks or review will approve a release. See the [official publishing requirements](https://docs.openclaw.ai/clawhub/publishing) and [validation guidance](https://docs.openclaw.ai/clawhub/plugin-validation-fixes).

## Publish and verify

Create a version-specific record under `docs/releases/`. Wait for CI on the intended commit, tag it, and attach the package, SHA256 checksums, provenance, and sanitized evidence to the GitHub prerelease.

Provenance should identify the source commit, host compatibility, package hash, CI run, and actual validation scope. Before upload, scan both the repository content and archive for credentials, private routes, hostnames, and machine-specific paths.

For deployment, follow the [maintenance guide](../maintenance.md), verify the target bot and idle state, back up, install, and check `/tgux` plus an ordinary request. Keep the previous verified release available for rollback.

GitHub distribution and ClawHub publication are separate operations. The published [0.2.0-beta.1 preparation record](../releases/0.2.0-beta.1-publishing.md) documents what has actually been completed.
