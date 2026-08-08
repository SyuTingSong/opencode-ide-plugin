export * as SuggestCompactTool from "./suggest-compact"

import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { CompactionSuggest } from "../session/compaction-suggest"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "suggest_compact"

export const Input = Schema.Struct({
  reason: Schema.String.annotate({
    description: "Why this is a stage boundary and old context is dead weight",
  }),
})

export const Output = Schema.Struct({
  received: Schema.Boolean,
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const suggest = yield* CompactionSuggest.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Suggest that the current session context be compacted because a logical stage of work has finished. Provide the reason.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output) }],
          execute: ({ reason }, context) =>
            // Only records the signal; the engine evaluates the suggestion at
            // the next safe step boundary and owns the compaction decision.
            suggest.request(context.sessionID, reason).pipe(Effect.as({ received: true })),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/suggest-compact",
  layer,
  deps: [ToolRegistry.node, CompactionSuggest.node],
})
