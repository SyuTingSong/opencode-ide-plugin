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
 * The engine's `estimateContext()` is anchored on provider-reported usage of
 * the latest response; the step hook only offers the built request, so this is
 * a pure heuristic with documented precision loss.
 */
const estimateTokens = (event: SessionStep) => Math.round(JSON.stringify(event.request).length / 4)

export default define({
  id: "suggest-compact",
  effect: Effect.fn("SuggestCompact.Plugin")(function* (ctx: Context) {
    const minTokens = envNumber("OPENCODE_SUGGEST_MIN_TOKENS", DEFAULT_MIN_TOKENS)
    const cooldownSteps = envNumber("OPENCODE_SUGGEST_COOLDOWN_STEPS", DEFAULT_COOLDOWN_STEPS)
    const pending = yield* Ref.make(new Map<string, string>())

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: "suggest_compact",
          // Without options, a plugin tool defaults into the Code Mode catalog
          // and is callable only through `execute`; keep this one native.
          options: { codemode: false },
          description:
            "Suggest compacting this session's context at a stage boundary: the moment the work just finished will not be needed in detail for what comes next. Check this at the END of every turn where you report a result, and call it in that same turn, alongside the report — not on the next turn. Trigger when ANY of these just happened: a deliverable was closed (MR/PR merged, pushed and verified, a document finalized, a migration step completed); a delegated task (subagent, dispatched session) returned and you finished verifying it; the next step is a different topic, repository, directory, or phase; the user moves on (\"next\", \"now do X\", a new unrelated request). Do NOT trigger while waiting on background work whose result must be checked against details only in this context, mid-debugging or mid-review with unapplied findings, or when compaction happened only a few turns ago. Self-check: if this session restarted now with a 10-line summary plus the files, MRs and plans on disk, could you do the next step without loss? If yes, call this tool. The engine evaluates the suggestion at the next safe step boundary; recording it is enough.",
          input: Schema.Struct({
            reason: Schema.String.annotate({
              description:
                "Name the stage that ended, pointers worth carrying (MR links, commit hashes, file paths, pending user decisions), and the next step",
            }),
          }),
          output: Schema.Struct({ received: Schema.Boolean }),
          execute: ({ reason }, context) =>
            Effect.gen(function* () {
              yield* Ref.update(pending, (map) => {
                const next = new Map(map)
                next.set(context.sessionID, reason)
                return next
              })
              yield* Effect.logInfo("suggest_compact requested", { sessionID: context.sessionID, reason })
              // Compaction is decided later by the engine (cooldown and token
              // gates); the model must not read a quiet step as a rejection.
              return {
                output: { received: true },
                content:
                  "Compaction suggestion recorded; the system evaluates it at the next safe step boundary and may not act on it. Do not suggest again for the same stage.",
              }
            }),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.session.hook("step", (event) =>
      Effect.gen(function* () {
        // Leave an already-requested compaction alone and keep any pending signal.
        if (event.result?.compact) return
        // A rejected suggestion is consumed; the model may suggest again later.
        const reason = yield* Ref.modify(pending, (map) => {
          const current = map.get(event.sessionID)
          if (current === undefined) return [undefined, map] as const
          const next = new Map(map)
          next.delete(event.sessionID)
          return [current, next] as const
        })
        if (reason === undefined) return

        // Cooldown counts provider steps recorded after the last completed
        // compaction entry, derived from history on every boundary. Anchoring on
        // an in-memory counter stamped when a suggestion happens to be observed
        // measures distance zero and rejects the first post-compaction
        // suggestion, and loses the window entirely across a server restart.
        const lastCompactionIndex = event.entries.findLastIndex(
          (entry) => entry.type === "compaction" && entry.status === "completed",
        )
        const stepsSinceCompaction =
          lastCompactionIndex === -1
            ? undefined
            : event.entries.slice(lastCompactionIndex + 1).filter((entry) => entry.type === "assistant").length
        const estTokens = estimateTokens(event)
        const inCooldown = stepsSinceCompaction !== undefined && stepsSinceCompaction < cooldownSteps
        const approved = !inCooldown && estTokens >= minTokens
        yield* Effect.logInfo("suggest_compact evaluated", {
          sessionID: event.sessionID,
          step: event.step,
          estTokens,
          approved,
          stepsSinceCompaction,
          reason,
        })
        if (!approved) return
        // The engine reuses its safe compaction path; "suggest" keeps parity
        // with the reason it surfaced before the migration.
        event.result = { compact: true, reason: "suggest" }
      }),
    )
  }),
})
