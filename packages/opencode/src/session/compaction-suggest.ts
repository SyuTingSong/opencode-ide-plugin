export * as CompactionSuggestV1 from "./compaction-suggest"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Ref } from "effect"

const DEFAULT_MIN_CONTEXT_TOKENS = Number(process.env.OPENCODE_SUGGEST_MIN_TOKENS ?? 100_000)
const DEFAULT_COOLDOWN_STEPS = Number(process.env.OPENCODE_SUGGEST_COOLDOWN_STEPS ?? 15)

/**
 * V1-session counterpart of the core `CompactionSuggest` service: the
 * suggest_compact tool only records a signal; the V1 prompt loop evaluates it
 * at the next round boundary and owns the compaction decision. State is
 * session-keyed because V1 and V2 runners never process the same session.
 */
export interface Interface {
  /** Records a suggestion from the `suggest_compact` tool; the latest reason wins. */
  readonly request: (sessionID: string, reason: string) => Effect.Effect<void>
  /**
   * Consumes any pending suggestion and reports whether it clears the
   * cooldown and the economic gate for the given context token count.
   * A rejected suggestion is dropped; the model may suggest again later.
   */
  readonly consider: (sessionID: string, tokens: number, step: number) => Effect.Effect<boolean>
  /** Marks a compaction boundary for cooldown tracking. */
  readonly compacted: (sessionID: string, step: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CompactionSuggestV1") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const pending = yield* Ref.make(new Map<string, string>())
    const lastCompact = yield* Ref.make(new Map<string, number>())

    const service = Service.of({
      request: (sessionID, reason) =>
        Ref.update(pending, (map) => {
          const next = new Map(map)
          next.set(sessionID, reason)
          return next
        }).pipe(Effect.tap(() => Effect.logInfo("suggest_compact requested", { sessionID, reason }))),
      consider: (sessionID, tokens, step) =>
        Effect.gen(function* () {
          const reason = yield* Ref.modify(pending, (map) => {
            const current = map.get(sessionID)
            if (current === undefined) return [undefined, map]
            const next = new Map(map)
            next.delete(sessionID)
            return [current, next]
          })
          if (reason === undefined) return false
          const last = yield* Ref.get(lastCompact)
          const previous = last.get(sessionID)
          const inCooldown = previous !== undefined && step - previous < DEFAULT_COOLDOWN_STEPS
          const approved = !inCooldown && tokens >= DEFAULT_MIN_CONTEXT_TOKENS
          yield* Effect.logInfo("suggest_compact evaluated", {
            sessionID,
            step,
            tokens,
            approved,
            lastCompactStep: previous,
            reason,
          })
          return approved
        }),
      compacted: (sessionID, step) =>
        Ref.update(lastCompact, (map) => {
          const next = new Map(map)
          next.set(sessionID, step)
          return next
        }),
    })
    return service
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })
