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

- Registers the `suggest_compact` tool. Calling it records a suggestion with a free-form
  `reason`; the suggestion is latest-wins and one-shot. A rejected suggestion (cooldown or
  economic gate) is dropped, and the model may suggest again later.
- Evaluates the recorded suggestion at every safe step boundary through the session step hook,
  before the next provider turn streams:

  1. If compaction was already requested at this boundary, the pending signal is preserved.
  2. The pending suggestion is consumed.
  3. Cooldown: history compaction entries anchor the window. When the last compaction entry's
     identity changes, the anchor step resets to the current boundary; suggestions within
     `cooldownSteps` of the anchor are rejected.
  4. Economic gate: the offered request is estimated by its serialized length (`bytes / 4`);
     below `minTokens` the suggestion is rejected.
  5. Approved suggestions request compaction with reason `"suggest"`, reusing the engine's safe
     compaction path. The model's semantic reason only surfaces in logs.

## Knobs

| Env var                          | Default   | Meaning                                          |
| -------------------------------- | --------- | ------------------------------------------------ |
| `OPENCODE_SUGGEST_MIN_TOKENS`    | `100000`  | Estimated context tokens required to approve      |
| `OPENCODE_SUGGEST_COOLDOWN_STEPS`| `15`      | Provider-turn steps of cooldown after a compaction|

## Precision

The core version anchored its estimate on provider-reported usage at the latest response. The
step hook only offers the built request, so this plugin estimates from the serialized request;
expect drift against provider billing. Extending `SessionStep` with model-limit fields would
restore exact numbers but needs core changes beyond this plugin.
