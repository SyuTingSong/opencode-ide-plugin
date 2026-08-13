---
name: upgrade-xts
---

# Upgrade xts Build

Remotes in this repo: `upstream` → anomalyco/opencode, `origin` → the fork (SyuTingSong/opencode-ide-plugin).

## Workflow

Run the script from the repo root:

```bash
bun run .opencode/skills/upgrade-xts/scripts/upgrade-xts.ts
```

The script:

1. Detects an in-progress rebase and resumes straight to the build phase.
2. Otherwise switches to `compact-suggest-mvp` (only when the working tree is clean), fetches `upstream dev --tags`, skips the rebase when the branch already contains `upstream/dev`, and otherwise rebases it.
3. Verifies the pinned bun version, runs `bun install`, reads the latest version from `upstream/dev`'s `packages/opencode/package.json`, and builds the xts binary with `OPENCODE_VERSION=<version>-xts`.

It exits non-zero with the list of conflicted files if the rebase needs manual resolution.

### On rebase conflicts

Resolve them file by file:

- Keep upstream's changes when the conflict is pure refactoring of code the branch never touched.
- Keep the branch's feature logic when the conflict is between the xts feature and unrelated upstream churn; re-apply any upstream refactors around it.
- After editing, `git add <file>` then `git rebase --continue`.
- If the resolution becomes messy, `git rebase --abort` and inspect the two sides first.

Then re-run the script; it resumes at the build phase.

The branch is force-pushed to the fork only if the user asks to sync it: `git push --force-with-lease origin compact-suggest-mvp`.

Notes:

- The build script requires the exact bun version pinned in the root `package.json` (`packageManager` field).
- The resulting binary is at `packages/opencode/dist/opencode-<os>-<arch>/bin/opencode` and a smoke test runs `--version` on it, which must print `<version>-xts`.
- `--single` builds only the current platform; `--skip-install` and `--skip-embed-web-ui` skip the cross-platform binary installs and the web UI embed, respectively.
- Do not use `OPENCODE_CHANNEL` or `OPENCODE_BUMP` — the plain `OPENCODE_VERSION` env var is the only override needed.
