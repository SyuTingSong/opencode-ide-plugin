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
- The description names two call moments: mid-task when a stage just closed, and at the start
  of a turn when the user moves to a new topic. Both must be issued in parallel with a real tool
  call, never as the only call of a step. It forbids calling at the end of a turn (the session may
  not continue and the call is no substitute for the final answer), in subagent tasks, in
  polling loops, more than once per turn, mid-debugging, or right after a checkpoint.
- Calling it records a suggestion for the session; the suggestion is
  latest-wins and one-shot. A rejected suggestion (cooldown or economic gate)
  is dropped, and the model may suggest again later. The tool result states the
  last observed context size against the gates (ignored below the threshold,
  ignored during cooldown, or "compaction runs before your next step") and tells
  the model to keep working.
- When the engine compacts for a non-manual reason, the `<conversation-checkpoint>` opens with a
  notice that compaction just happened, so the model continues instead of redoing or re-suggesting.
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
     compaction path.

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
