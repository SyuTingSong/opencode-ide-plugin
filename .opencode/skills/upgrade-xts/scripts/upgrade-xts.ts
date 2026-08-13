#!/usr/bin/env bun

import { $ } from "bun"
import { resolve } from "path"

const branch = "compact-suggest-mvp"
const root = resolve(import.meta.dir, "../../../..")

const inRebase =
  (await $`test -d .git/rebase-merge`.cwd(root).quiet().nothrow()).exitCode === 0 ||
  (await $`test -d .git/rebase-apply`.cwd(root).quiet().nothrow()).exitCode === 0

if (inRebase) {
  console.log("Rebase in progress, skipping fetch/rebase")
} else {
  const current = (await $`git branch --show-current`.cwd(root).quiet().text()).trim()
  const dirty = (await $`git status --porcelain`.cwd(root).quiet().text()).trim().length > 0
  if (current !== branch) {
    if (dirty) {
      console.error(`On branch ${current}, not ${branch}, and the working tree is dirty. Commit or stash first.`)
      process.exit(1)
    }
    await $`git checkout ${branch}`.cwd(root)
    console.log(`Switched from ${current} to ${branch}`)
  }

  await $`git fetch upstream dev --tags`.cwd(root)

  const containsUpstream =
    (await $`git merge-base --is-ancestor upstream/dev HEAD`.cwd(root).quiet().nothrow()).exitCode === 0
  if (containsUpstream) {
    console.log("Already up to date with upstream/dev")
  } else {
    if (dirty) {
      console.error("The working tree has uncommitted changes. Commit or stash them before rebasing.")
      process.exit(1)
    }
    const rebase = (await $`git rebase upstream/dev`.cwd(root).nothrow()).exitCode
    if (rebase !== 0) {
      const conflicts = (await $`git diff --name-only --diff-filter=U`.cwd(root).quiet().text()).trim()
      console.error("Rebase conflicted in:")
      console.error(conflicts || "(no unmerged files)")
      console.error(
        "Resolve the conflicts, then `git add <file>` and `git rebase --continue`, then re-run this script.",
      )
      process.exit(1)
    }
    console.log("Rebased onto upstream/dev")
  }
}

const rootPkg = await Bun.file(resolve(root, "package.json")).json()
const pinnedBun = rootPkg.packageManager.replace("bun@", "")
const actualBun = (await $`bun --version`.quiet().text()).trim()
if (pinnedBun !== actualBun) {
  console.error(`bun ${actualBun} does not match pinned ${pinnedBun} in package.json`)
  process.exit(1)
}

await $`bun install`.cwd(root)

const version = JSON.parse(
  (await $`git show upstream/dev:packages/opencode/package.json`.cwd(root).quiet().text()),
).version
console.log(`Building xts binary for v${version}`)

await $`bun run packages/opencode/script/build.ts --single --skip-install --skip-embed-web-ui`
  .env({ ...process.env, OPENCODE_VERSION: `${version}-xts` })
  .cwd(root)

const os = process.platform === "win32" ? "windows" : process.platform
const binary = resolve(root, `packages/opencode/dist/opencode-${os}-${process.arch}/bin/opencode`)
console.log(`Binary: ${binary}`)
