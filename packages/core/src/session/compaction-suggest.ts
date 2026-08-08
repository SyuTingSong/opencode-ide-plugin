export * as CompactionSuggest from "./compaction-suggest"

import { makeLocationNode } from "../effect/app-node"
import { Context, Effect, Layer, Ref } from "effect"
import { SessionSchema } from "./schema"

/**
 * MVP thresholds (ADR-001 economic gate): an absolute token floor instead of a
 * context-fill ratio, so the gate works for 1M-context models and stays below
 * per-provider pricing tiers. Values are initial guesses to tune from real
 * sessions.
 */
export const DEFAULT_MIN_CONTEXT_TOKENS = 100_000
export const DEFAULT_COOLDOWN_STEPS = 5

// Test lever: lets real-session runs lower the economic gate without a rebuild.
const envMinContextTokens = () => {
  const raw = process.env.OPENCODE_SUGGEST_MIN_TOKENS
  return raw === undefined ? DEFAULT_MIN_CONTEXT_TOKENS : Number(raw)
}

export interface Options {
  readonly minContextTokens: number
  readonly cooldownSteps: number
}

/**
 * In-memory session state for the built-in `suggest_compact` tool: the tool
 * only records a signal; the runner evaluates it at the next safe step
 * boundary and owns the compaction decision.
 */
export interface Interface {
  /** Records a suggestion from the `suggest_compact` tool; the latest reason wins. */
  readonly request: (sessionID: SessionSchema.ID, reason: string) => Effect.Effect<void>
  /**
   * Consumes any pending suggestion and reports whether it clears the
   * cooldown and the economic gate for the given estimated context tokens.
   * A rejected suggestion is dropped; the model may suggest again later.
   */
  readonly consider: (sessionID: SessionSchema.ID, step: number, estTokens: number) => Effect.Effect<boolean>
  /** Marks a compaction boundary for cooldown tracking. */
  readonly compacted: (sessionID: SessionSchema.ID, step: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/CompactionSuggest") {}

export function make(options: Partial<Options> = {}) {
  const minContextTokens = options.minContextTokens ?? envMinContextTokens()
  const cooldownSteps = options.cooldownSteps ?? DEFAULT_COOLDOWN_STEPS
  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const pending = yield* Ref.make(new Map<SessionSchema.ID, string>())
      const lastCompact = yield* Ref.make(new Map<SessionSchema.ID, number>())

      const service = Service.of({
        request: (sessionID, reason) =>
          Ref.update(pending, (map) => {
            const next = new Map(map)
            next.set(sessionID, reason)
            return next
          }).pipe(
            Effect.tap(() => Effect.logInfo("suggest_compact requested", { sessionID, reason })),
          ),
        consider: (sessionID, step, estTokens) =>
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
            const inCooldown = previous !== undefined && step - previous < cooldownSteps
            const approved = !inCooldown && estTokens >= minContextTokens
            yield* Effect.logInfo("suggest_compact evaluated", {
              sessionID,
              step,
              estTokens,
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
  return layer
}

export const locationLayer = make()

export const node = makeLocationNode({ service: Service, layer: locationLayer, deps: [] })
