import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { CompactionSuggestV1 } from "../session/compaction-suggest"

export const Parameters = Schema.Struct({
  reason: Schema.String.annotate({ description: "Why this is a stage boundary and old context is dead weight" }),
})

type Metadata = Record<string, never>

export const SuggestCompactV1Tool = Tool.define<typeof Parameters, Metadata, CompactionSuggestV1.Service>(
  "suggest_compact",
  Effect.gen(function* () {
    const suggest = yield* CompactionSuggestV1.Service

    return {
      description:
        "Suggest that the current session context be compacted because a logical stage of work has finished. Provide the reason.",
      parameters: Parameters,
      execute: ({ reason }, ctx) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "suggest_compact",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })
          // Only records the signal; the prompt loop evaluates the suggestion
          // at the next round boundary and owns the compaction decision.
          yield* suggest.request(ctx.sessionID, reason)
          return {
            title: "Compaction suggested",
            output: "Suggestion received; compaction is evaluated at the next round boundary.",
            metadata: {},
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
