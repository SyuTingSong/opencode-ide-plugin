---
name: upgrade-xts
description: Upgrade the xts build of opencode — fetch upstream, rebase the compact-suggest-mvp branch onto upstream/dev (resolving conflicts), find the latest upstream version, and build a local `-xts` binary. Use when the user asks to upgrade/rebuild xts opencode, bump the xts build, or rebase compact-suggest-mvp onto dev.
---

# Upgrade xts Build

Remotes in this repo: `upstream` → anomalyco/opencode, `origin` → the fork (SyuTingSong/opencode-ide-plugin).

## Workflow

### 1. Fetch upstream

```bash
git fetch upstream dev --tags
```

### 2. Rebase the feature branch onto upstream/dev

Make sure the current branch is `compact-suggest-mvp`; if not, switch to it. Then:

```bash
git rebase upstream/dev
```

If conflicts arise, resolve them file by file:

- Keep upstream's changes when the conflict is pure refactoring of code the branch never touched.
- Keep the branch's feature logic when the conflict is between the xts feature and unrelated upstream churn; re-apply any upstream refactors around it.
- After editing, `git add <file>` then `git rebase --continue`.
- If the resolution becomes messy, `git rebase --abort` and inspect the two sides first.

The branch is force-pushed to the fork only if the user asks to sync it: `git push --force-with-lease origin compact-suggest-mvp`.

### 3. Install dependencies

The rebase may have changed dependencies, so re-install before building:

```bash
bun install
```

### 4. Find the latest version tag on upstream/dev

The version lives in `packages/opencode/package.json`; the matching tag is `v<version>`:

```bash
git show upstream/dev:packages/opencode/package.json | grep '"version"'
git tag --sort=-creatordate --format='%(refname:short)' | head -5
```

Use the version from the tag (`v1.18.16` → `1.18.16`), not the `v26.x.x` or `github-*` tags.

### 5. Build the xts binary

```bash
OPENCODE_VERSION=<version>-xts bun run packages/opencode/script/build.ts --single --skip-install --skip-embed-web-ui
```

Notes:

- The build script requires the exact bun version pinned in the root `package.json` (`packageManager` field).
- The resulting binary is at `packages/opencode/dist/opencode-<os>-<arch>/bin/opencode` and a smoke test runs `--version` on it, which must print `<version>-xts`.
- `--single` builds only the current platform; `--skip-install` and `--skip-embed-web-ui` skip the cross-platform binary installs and the web UI embed, respectively.
- Do not use `OPENCODE_CHANNEL` or `OPENCODE_BUMP` — the plain `OPENCODE_VERSION` env var is the only override needed.
