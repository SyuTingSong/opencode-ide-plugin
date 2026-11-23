import { define, type Context } from "@opencode/plugin/effect/plugin"
import type { SessionStep } from "@opencode/plugin/effect/session"
import { Effect, Ref, Schema } from "effect"

/**
 * Suggest Compact: reimplements the former core built-in `suggest_compact` as a
 * standalone plugin. The tool only records a signal; the session step hook
 * evaluates it at the next safe step boundary and the engine reuses its safe
 * compaction path.
 */

export const DEFAULT_MIN_TOKENS = 100_000
export const DEFAULT_COOLDOWN_STEPS = 15

// Env knobs keep the MVP thresholds tunable without a rebuild.
const envNumber = (name: string, fallback: number) => {
  const raw = process.env[name]
  const value = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/**
 * Fallback for cores whose `SessionStep` predates `contextTokens`: the
 * serialized request divided by four. English-shaped and blind to CJK, so the
 * engine's own estimate is preferred whenever the event carries it.
 */
const estimateTokens = (event: SessionStep) => Math.round(JSON.stringify(event.request).length / 4)

type Observed = { estTokens: number; stepsSinceCompaction: number | undefined }

const stepsSince = (event: SessionStep) => {
  const lastCompactionIndex = event.entries.findLastIndex(
    (entry) => entry.type === "compaction" && entry.status === "completed",
  )
  if (lastCompactionIndex === -1) return undefined
  return event.entries.slice(lastCompactionIndex + 1).filter((entry) => entry.type === "assistant").length
}

const thousands = (tokens: number) => `${Math.round(tokens / 1000)}k`

// The reply tells the model where it stands against the gates and asks it to
// keep working: a bare acknowledgement read as a turn-ending ritual.
const reply = (state: Observed | undefined, minTokens: number, cooldownSteps: number) => {
  const keepWorking = "Continue working; do not suggest again for this stage."
  const checkpoint = "Compaction runs before your next step and you will see a `<conversation-checkpoint>`."
  if (state === undefined) return `Recorded. If accepted, ${checkpoint.toLowerCase()} ${keepWorking}`
  const context = `context ≈ ${thousands(state.estTokens)}`
  if (state.stepsSinceCompaction !== undefined && state.stepsSinceCompaction < cooldownSteps)
    return `Recorded, but ignored: the last compaction was ${state.stepsSinceCompaction} steps ago (cooldown ${cooldownSteps}; ${context}). ${keepWorking}`
  if (state.estTokens < minTokens)
    return `Recorded, but ignored (${context}; suggestions below ${thousands(minTokens)} are not acted on). ${keepWorking}`
  return `Recorded (${context}). ${checkpoint} ${keepWorking}`
}

export default define({
  id: "suggest-compact",
  effect: Effect.fn("SuggestCompact.Plugin")(function* (ctx: Context) {
    const minTokens = envNumber("OPENCODE_SUGGEST_MIN_TOKENS", DEFAULT_MIN_TOKENS)
    const cooldownSteps = envNumber("OPENCODE_SUGGEST_COOLDOWN_STEPS", DEFAULT_COOLDOWN_STEPS)
    const pending = yield* Ref.make(new Set<string>())
    // Last observed boundary per session, so the tool can tell the model where
    // it stands against the gates.
    const latest = yield* Ref.make(new Map<string, Observed>())

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "suggest_compact",
          // Without options, a plugin tool defaults into the Code Mode catalog
          // and is callable only through `execute`; keep this one native.
          options: { codemode: false },
          description:
            "Suggest compacting this session's context so the work ahead runs on a summary instead of the full history. Call it at one of two moments, always in parallel with a real tool call in the same step, never as the only call of a step: (a) Mid-task, when a stage just closed (MR pushed and verified, a subagent's result checked, a migration step done) and the next stage does not need that stage's details: issue it together with the first tool call of the next stage. (b) At the start of a turn, when the user moves to a new topic, repository or phase: issue it together with your first tool call. Never call it at the end of a turn: the session may not continue, and it is never a substitute for your final answer to the user. Never call it in a subagent task, inside a polling or watch loop, more than once per turn, mid-debugging or mid-review with unapplied findings, or right after a `<conversation-checkpoint>`. Self-check: if this session restarted now with a 10-line summary plus the files, MRs and plans on disk, could the next stage proceed without loss?",
          input: Schema.Struct({}),
          output: Schema.Struct({ received: Schema.Boolean }),
          execute: (_, context) =>
            Effect.gen(function* () {
              yield* Ref.update(pending, (set) => {
                const next = new Set(set)
                next.add(context.sessionID)
                return next
              })
              yield* Effect.logInfo("suggest_compact requested", { sessionID: context.sessionID })
              // Compaction is decided later by the engine (cooldown and token
              // gates); the model must not read a quiet step as a rejection.
              const state = (yield* Ref.get(latest)).get(context.sessionID)
              return {
                output: { received: true },
                content: reply(state, minTokens, cooldownSteps),
              }
            }),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.session.hook("step", (event) =>
      Effect.gen(function* () {
        // Cooldown counts provider steps recorded after the last completed
        // compaction entry, derived from history on every boundary. Anchoring on
        // an in-memory counter stamped when a suggestion happens to be observed
        // measures distance zero and rejects the first post-compaction
        // suggestion, and loses the window entirely across a server restart.
        const stepsSinceCompaction = stepsSince(event)
        const estTokens = event.contextTokens ?? estimateTokens(event)
        yield* Ref.update(latest, (map) => new Map(map).set(event.sessionID, { estTokens, stepsSinceCompaction }))
        // Leave an already-requested compaction alone and keep any pending signal.
        if (event.result?.compact) return
        // A rejected suggestion is consumed; the model may suggest again later.
        const requested = yield* Ref.modify(pending, (set) => {
          const has = set.has(event.sessionID)
          if (!has) return [false, set]
          const next = new Set(set)
          next.delete(event.sessionID)
          return [true, next]
        })
        if (!requested) return

        const inCooldown = stepsSinceCompaction !== undefined && stepsSinceCompaction < cooldownSteps
        const approved = !inCooldown && estTokens >= minTokens
        yield* Effect.logInfo("suggest_compact evaluated", {
          sessionID: event.sessionID,
          step: event.step,
          estTokens,
          approved,
          stepsSinceCompaction,
        })
        if (!approved) return
        // The engine reuses its safe compaction path; "suggest" keeps parity
        // with the reason it surfaced before the migration.
        event.result = { compact: true, reason: "suggest" }
      }),
    )
  }),
})
