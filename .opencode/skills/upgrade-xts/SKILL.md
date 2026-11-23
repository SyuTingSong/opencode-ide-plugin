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
2. Otherwise switches to `suggest-compact` (only when the working tree is clean), fetches `upstream dev --tags`, skips the rebase when the branch already contains `upstream/dev`, and otherwise rebases it.
3. Verifies the pinned bun version, runs `bun install`, and reads the build version from the newest upstream `v[0-9]*` release tag whose release commit adds only version metadata on top of a parent already in `upstream/dev` (dev's package.json version lags releases; falls back to dev's version when no tag qualifies), and builds the xts binary with `OPENCODE_VERSION=<version>-xts`.
4. Points `~/.bin/opencode` at the fresh binary (`mkdir -p ~/.bin` then `ln -sfnh`).

It exits non-zero with the list of conflicted files if the rebase needs manual resolution.

### On rebase conflicts

Resolve them file by file:

- Keep upstream's changes when the conflict is pure refactoring of code the branch never touched.
- Keep the branch's feature logic when the conflict is between the xts feature and unrelated upstream churn; re-apply any upstream refactors around it.
- After editing, `git add <file>` then run `GIT_EDITOR=true git rebase --continue`. The plain command hangs without a TTY here: with `core.editor` set to an interactive editor (vim), the conflict-resolution commit opens it before writing, so the shell call never returns. `GIT_EDITOR=true` skips the editor; expect the step to finish in seconds — a "stuck" continue is this, not a hung git process.
- If the resolution becomes messy, `git rebase --abort` and inspect the two sides first.
- The lockfile-regen commit (`chore: regenerate lockfile after upstream bump`) always conflicts on `bun.lock`: take the upstream side with `git checkout --ours bun.lock`, run `bun install` to regenerate against the merged tree, `git add bun.lock` and continue — this matches the commit's intent rather than hand-merging hunks.

Then re-run the script; it resumes at the build phase.

The branch is force-pushed to the fork only if the user asks to sync it: `git push --force-with-lease origin suggest-compact`.

Notes:

- The build script requires the exact bun version pinned in the root `package.json` (`packageManager` field). When bun is managed by proto, `bun upgrade` fails; use `proto install bun <pinned-version> --pin` instead.
- After the pin changes (upstream bump), the bare `bun` shim may still resolve to the old version in the worktree — `proto exec bun -- ...` always honors the project `.prototools` pin, so run the script and the version check through it: `proto exec bun -- bun run .opencode/skills/upgrade-xts/scripts/upgrade-xts.ts`.
- The resulting binary is at `packages/cli/dist/cli-<os>-<arch>/bin/opencode` and a smoke test runs `--version` on it, which must print `opencode v<version>-xts`.
- `--single` builds only the current platform; `--skip-install` and `--skip-web-ui` skip the cross-platform binary installs and the web UI embed, respectively.
- Do not use `OPENCODE_CHANNEL` or `OPENCODE_BUMP` — the plain `OPENCODE_VERSION` env var is the only override needed.
- When the build prints `(no safe release tag; dev version)`, upstream shipped releases whose base commit is not in `dev` or whose release commit touches source files. Check the newest tags by hand (`git diff --name-only <tag>^ <tag>` and `git merge-base --is-ancestor <tag>^ upstream/dev`) before trusting the dev fallback — it can lag the shipped release.
- The remote branch's pre-push hook runs a full `bun run check` and blocks the push while it fails. The lint half passes locally, but the typecheck half fails on upstream packages (`httpapi-codegen`, `http-recorder`) even on untouched upstream code, so pushes go through with `--no-verify`. Do not push feature code without rescuing its own lint failures first.
