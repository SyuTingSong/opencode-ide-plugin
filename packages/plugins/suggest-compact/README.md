# Suggest Compact

Lets the model suggest that a finished stage of work should be compacted. It targets the exact
workflow that stopped needing core support once the session step hook landed: the agent's session
grows across long tasks, and the model knows when a logical stage is complete better than a pure
token threshold does.

## Install

Install directly from Git:

```sh
opencode plugin add 'git+https://github.com/anomalyco/opencode.git#path:packages/plugins/suggest-compact'
```

The URL selects this directory and uses the repository's default branch, so no explicit branch name is needed. The plugin exports `index.ts` directly; there is no build step or installation hook.

For local development, add the directory to `plugins` in the project's `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./packages/plugins/suggest-compact"],
}
```

The plugin is not activated merely by being present in the repository. Installing it adds it to the user's configuration.

## Behavior

- Registers the `suggest_compact` tool **on the provider's native tool list**
  (`options: { codemode: false }`). Tools registered without this option default
  into the Code Mode catalog, where they surface only as one entry among MCP
  tools and can only be called through the `execute` tool — in practice that
  keeps them out of the model's line of sight, so stage boundaries pass without
  a call. On the native list the full description is visible on every request.
- The description is written as observable events, not an abstract concept: it
  names the closing events that count (deliverable merged/verified, delegated
  task verified, next step is a different topic or repo, user moves on), the
  anti-cases (waiting on background results, mid-debugging or mid-review, too
  soon after the last compaction), and binds the check to the turn that reports
  the result — call it in that same turn, not the next one.
- Calling it records a suggestion with a free-form `reason`; the suggestion is
  latest-wins and one-shot. A rejected suggestion (cooldown or economic gate)
  is dropped, and the model may suggest again later. The tool result tells the
  model the system decides at the next safe boundary, so a quiet boundary after
  a rejected suggestion does not read as failure.
- Evaluates the recorded suggestion at every safe step boundary through the session step hook,
  before the next provider turn streams:

  1. If compaction was already requested at this boundary, the pending signal is preserved.
  2. The pending suggestion is consumed.
  3. Cooldown: the window counts provider steps (assistant messages) recorded after the last
      completed compaction entry in the projected history. Deriving the anchor from history on
      every boundary keeps the count exact across server restarts, and a suggestion is never
      rejected merely for being the first one observed after a compaction. A failed compaction
      does not start a window.
  4. Economic gate: the boundary's `contextTokens` — the engine's own context estimate, the same
      number the automatic compaction gate reads — below `minTokens` rejects the suggestion.
  5. Approved suggestions request compaction with reason `"suggest"`, reusing the engine's safe
     compaction path. The model's semantic reason only surfaces in logs.

## Knobs

| Env var                          | Default   | Meaning                                          |
| -------------------------------- | --------- | ------------------------------------------------ |
| `OPENCODE_SUGGEST_MIN_TOKENS`    | `100000`  | Estimated context tokens required to approve      |
| `OPENCODE_SUGGEST_COOLDOWN_STEPS`| `15`      | Provider-turn steps of cooldown after a compaction|

## Precision

The gate reads `SessionStep.contextTokens`, the engine's own context estimate: provider-reported
usage at the latest measured response plus a local estimate of the unmeasured tail. Before any
measured response exists (session start, after a model switch) that number is a whole-request
char estimate. On cores whose `SessionStep` predates the field, the plugin falls back to
estimating from the serialized request, which undercounts CJK-heavy sessions by design.
