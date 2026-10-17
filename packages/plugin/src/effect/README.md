# OpenCode V2 Effect Plugin API

The Effect plugin API grants plugins two in-process capabilities:

- `hook` installs behavior at an OpenCode extension point.
- `reload` reruns every transform hook for a stateful domain.

## Defining A Plugin

```ts
import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "example",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((editor) => {
      editor.update("example", (provider) => {
        provider.name = "Example"
      })
    })
  }),
})
```

Plugin setup registers hooks imperatively through each domain's `hook` method.

Configuration supplied for the plugin is available as `ctx.options`.

Registrations are owned by the plugin scope. Closing the scope removes them automatically; a registration may also be removed early through `dispose`.

## Transform Hooks

Transform hooks contribute to stateful domains. Their editor callbacks are
synchronous, so load effectful data before registering a transform or reloading
its domain:

```ts
yield *
  ctx.agent.transform((agent) => {
    agent.update("reviewer", (item) => {
      item.description = "Reviews code for regressions"
      item.mode = "subagent"
    })
  })
```

Registry reads rebuild synchronously when registrations changed, applying every transform in registration order to a fresh value; unchanged registries return the previous value. Values read earlier are never mutated. Notifications and resource reconciliation run separately from that materialization.

Available transform hooks are namespaced by domain:

```ts
ctx.agent.transform
ctx.command.transform
ctx.integration.transform
ctx.mcp.transform
ctx.model.transform
ctx.provider.transform
ctx.reference.transform
ctx.skill.transform
ctx.tool.transform
ctx.vcs.transform
ctx.websearch.transform
```

Provider transforms contribute provider settings and immutable model definitions. After provider availability is resolved,
model transforms edit the complete active-provider candidate collection in order. Use `ctx.model.transform` for runtime
model restrictions; `editor.provider.get()` reads source templates even when their provider is inactive.

```ts
Effect.gen(function* () {
  yield* ctx.model.transform((editor) => {
    editor
      .list()
      .filter((model) => model.cost.some((tier) => tier.output > 20))
      .forEach((model) => {
        editor.remove(model.providerID, model.id)
      })
  })
})
```

## Runtime Hooks

Runtime hooks intercept live operations rather than rebuilding domain state:

```ts
yield *
  ctx.aisdk.hook(
    "sdk",
    Effect.fn(function* (event) {
      if (event.package !== "@ai-sdk/xai") return
      const mod = yield* Effect.promise(() => import("@ai-sdk/xai"))
      event.sdk = mod.createXai(event.options)
    }),
  )

yield *
  ctx.aisdk.hook("language", (event) =>
    Effect.sync(() => {
      if (event.model.providerID !== "xai") return
      event.language = event.sdk.responses(event.model.modelID)
    }),
  )
```

Hooks run sequentially in registration order. Later hooks observe mutations made by earlier hooks.

Session context is mutable immediately before provider dispatch:

```ts
yield *
  ctx.session.hook("context", (event) =>
    Effect.sync(() => {
      event.tools.read.description = "Read a file using narrow line ranges."
      delete event.tools.write
    }),
  )

yield *
  ctx.session.hook("retry", (event) =>
    Effect.sync(() => {
      if (event.attempt >= 3) event.decision = { retry: false }
    }),
  )
```

The session step hook runs at every safe step boundary, after tool settlement and before the next provider turn
streams:

```ts
yield *
  ctx.session.hook("step", (event) =>
    Effect.sync(() => {
      if (event.step === 1) return
      // Estimate exact token counts from the built request; read projected
      // history entries for todo transitions, tool-output ratios, and the last
      // compaction anchor.
      event.result = { compact: true, reason: "plan-transition" }
    }),
  )
```

Setting `result` requests compaction. The engine reuses its safe compaction path at the boundary and re-runs the same
step with compacted history; the reason is surfaced on the compaction events. Plugins own their cooldown: keep
requesting from the last compaction anchor (a `compaction` entry in `event.entries`) so repeated requests cannot loop.
For a model-requested variant — where the model calls a `suggest_compact` tool and the step hook evaluates the
recorded signal against cooldown and a token gate — see [`packages/plugins/suggest-compact`](../../../plugins/suggest-compact/README.md).

## Reloading A Domain

When data captured by a transform changes, reload the affected domain:

```ts
Effect.gen(function* () {
  const source = { providers: yield* loadProviders() }

  yield* ctx.provider.transform((editor) => {
    source.providers.forEach((provider) => editor.add(provider))
  })

  source.providers = yield* loadProviders()
  yield* ctx.provider.reload()
})
```

`loadProviders()` returns entries shaped as `{ info: Provider.Info, models: readonly Model.Info[] }`. Provider reloads
also invalidate the active model result, so every model transform runs again with the refreshed definitions. Model
callbacks edit raw overrides; provider defaults are merged once when the result is committed.

Available reload operations are:

```ts
ctx.agent.reload()
ctx.command.reload()
ctx.integration.reload()
ctx.mcp.reload()
ctx.model.reload()
ctx.provider.reload()
ctx.reference.reload()
ctx.skill.reload()
ctx.tool.reload()
ctx.vcs.reload()
ctx.websearch.reload()
```
