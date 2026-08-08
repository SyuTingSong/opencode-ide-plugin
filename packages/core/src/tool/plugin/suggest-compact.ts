export * as SuggestCompactTool from "./suggest-compact.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { CompactionSuggest } from "../../session/compaction-suggest.js"

export const name = "suggest_compact"

export const Input = Schema.Struct({
  reason: Schema.String.annotate({
    description: "Why this is a stage boundary and old context is dead weight",
  }),
})

export const Output = Schema.Struct({
  received: Schema.Boolean,
})

/**
 * The tool only records the signal; the runner evaluates it at the next safe
 * step boundary and owns the compaction decision.
 */
export const Plugin = {
  id: "opencode.tool.suggest_compact",
  effect: Effect.fn("SuggestCompactTool.Plugin")(function* (ctx: Context) {
    const suggest = yield* CompactionSuggest.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          description:
            "Suggest that the current session context be compacted because a logical stage of work has finished. Provide the reason.",
          input: Input,
          output: Output,
          execute: ({ reason }, context) =>
            suggest
              .request(context.sessionID, reason)
              .pipe(Effect.as({ output: { received: true }, content: "Compaction suggestion recorded." })),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
