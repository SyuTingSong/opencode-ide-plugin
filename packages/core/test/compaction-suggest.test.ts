import { describe, expect } from "bun:test"
import { CompactionSuggest } from "@opencode-ai/core/session/compaction-suggest"
import { SessionV2 } from "@opencode-ai/core/session"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(CompactionSuggest.make({ minContextTokens: 100, cooldownSteps: 2 }))

const sessionID = SessionV2.ID.make("ses_compaction_suggest")

describe("CompactionSuggest", () => {
  it.effect("rejects when no suggestion is pending", () =>
    Effect.gen(function* () {
      const suggest = yield* CompactionSuggest.Service
      expect(yield* suggest.consider(sessionID, 1, 1_000)).toBe(false)
    }),
  )

  it.effect("approves a suggestion above the token gate and consumes it once", () =>
    Effect.gen(function* () {
      const suggest = yield* CompactionSuggest.Service
      yield* suggest.request(sessionID, "stage boundary")
      expect(yield* suggest.consider(sessionID, 1, 1_000)).toBe(true)
      expect(yield* suggest.consider(sessionID, 1, 1_000)).toBe(false)
    }),
  )

  it.effect("rejects a suggestion below the token gate and consumes it", () =>
    Effect.gen(function* () {
      const suggest = yield* CompactionSuggest.Service
      yield* suggest.request(sessionID, "stage boundary")
      expect(yield* suggest.consider(sessionID, 1, 50)).toBe(false)
      expect(yield* suggest.consider(sessionID, 1, 1_000)).toBe(false)
    }),
  )

  it.effect("rejects during the cooldown after a compaction boundary", () =>
    Effect.gen(function* () {
      const suggest = yield* CompactionSuggest.Service
      yield* suggest.compacted(sessionID, 1)
      yield* suggest.request(sessionID, "again")
      expect(yield* suggest.consider(sessionID, 1, 1_000)).toBe(false)
      yield* suggest.request(sessionID, "again")
      expect(yield* suggest.consider(sessionID, 3, 1_000)).toBe(true)
    }),
  )
})
