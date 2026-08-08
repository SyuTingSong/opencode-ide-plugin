# OpenCode V2 Effect Plugin API

The Effect plugin API grants plugins two in-process capabilities:

- `hook` installs behavior at an OpenCode extension point.
- `reload` reruns every transform hook for a stateful domain.

The public server client will be exposed separately. It is intentionally not part of `PluginContext` yet.

## Defining A Plugin

```ts
import { define } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"

export const Plugin = define({
  id: "example",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update("example", (provider) => {
        provider.name = "Example"
      })
    })
  }),
})
```

Plugin setup registers hooks imperatively. It does not return a hook object.

Configuration supplied for the plugin is available as `ctx.options`.

Registrations are owned by the plugin scope. Closing the scope removes them automatically; a registration may also be removed early through `dispose`.

## Transform Hooks

Transform hooks contribute to stateful domains:

```ts
yield *
  ctx.agent.transform((agent) => {
    agent.update("reviewer", (item) => {
      item.description = "Reviews code for regressions"
      item.mode = "subagent"
    })
  })
```

OpenCode rebuilds the domain when a transform is registered or disposed. A rebuild starts from fresh domain state and runs every active transform in registration order.

Available transform hooks are namespaced by domain:

```ts
ctx.agent.transform
ctx.catalog.transform
ctx.command.transform
ctx.integration.transform
ctx.reference.transform
ctx.skill.transform
```

## Runtime Hooks

Runtime hooks intercept live operations rather than rebuilding domain state:

```ts
yield *
  ctx.aisdk.sdk(
    Effect.fn(function* (event) {
      if (event.package !== "@ai-sdk/xai") return
      const mod = yield* Effect.promise(() => import("@ai-sdk/xai"))
      event.sdk = mod.createXai(event.options)
    }),
  )

yield *
  ctx.aisdk.language((event) => {
    if (event.model.providerID !== "xai") return
    event.language = event.sdk.responses(event.model.api.id)
  })
```

Hooks run sequentially in registration order. Later hooks observe mutations made by earlier hooks.

## Session Step Hook

The session domain exposes one runtime hook at every safe step boundary (after
tool settlement, before the next provider turn streams):

```ts
yield * ctx.session.step((input) => {
  if (input.step === 1) return { compact: false }
  // Estimate exact token counts from the built request; read projected
  // history entries for todo transitions, tool-output ratios, and the last
  // compaction anchor.
  return { compact: true, reason: "plan-transition" }
})
```

Returning `{ compact: true }` requests compaction. The engine reuses its safe
compaction path at the boundary and re-runs the same step with compacted
history; the returned `reason` is surfaced on the compaction events. Plugins
own their cooldown: keep requesting from the last compaction anchor (a
`compaction` entry in `input.entries`) so repeated requests cannot loop.

## Reloading A Domain

When data captured by a transform changes, reload the affected domain:

```ts
let data = yield * loadCatalog()

yield *
  ctx.catalog.transform((catalog) => {
    applyCatalog(data, catalog)
  })

data = yield * loadCatalog()
yield * ctx.catalog.reload()
```

Reload belongs to the domain, not an individual registration. `ctx.catalog.reload()` reruns every active catalog transform and publishes the rebuilt catalog.

Available reload operations are:

```ts
ctx.agent.reload()
ctx.catalog.reload()
ctx.command.reload()
ctx.integration.reload()
ctx.reference.reload()
ctx.skill.reload()
```
