import { describe, expect } from "bun:test"
import type { SessionStepInput } from "@opencode-ai/plugin/v2/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { PluginSession } from "@opencode-ai/core/plugin/session"
import { Effect, Exit, Scope } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(PluginSession.node))

const stepInput = (): SessionStepInput => ({
  sessionID: "ses_plugin",
  step: 1,
  model: { id: "fake", provider: "fake", route: {} },
  request: { model: { id: "fake", provider: "fake", route: {} }, system: [], messages: [], tools: [] },
  entries: [],
})

describe("PluginSession", () => {
  it.effect("returns undefined when no step hook is registered", () =>
    Effect.gen(function* () {
      const session = yield* PluginSession.Service
      expect(yield* session.runStep(stepInput())).toBeUndefined()
    }),
  )

  it.effect("runs step hooks in order and returns the first compaction request", () =>
    Effect.gen(function* () {
      const session = yield* PluginSession.Service
      const calls: string[] = []
      yield* session.hook.step((input) => {
        calls.push(`first:${input.step}`)
        return { compact: false }
      })
      yield* session.hook.step((input) => {
        calls.push(`second:${input.step}`)
        return { compact: true, reason: "plan-transition" }
      })
      yield* session.hook.step(() => {
        calls.push("third")
        return { compact: true, reason: "suggest" }
      })
      expect(yield* session.runStep(stepInput())).toEqual({ compact: true, reason: "plan-transition" })
      expect(calls).toEqual(["first:1", "second:1"])
    }),
  )

  it.effect("disposes a step hook registration", () =>
    Effect.gen(function* () {
      const session = yield* PluginSession.Service
      const registration = yield* session.hook.step(() => ({ compact: true, reason: "temporary" }))
      expect(yield* session.runStep(stepInput())).toMatchObject({ compact: true })
      yield* registration.dispose
      expect(yield* session.runStep(stepInput())).toBeUndefined()
    }),
  )

  it.effect("removes step hooks when their scope closes", () =>
    Effect.gen(function* () {
      const session = yield* PluginSession.Service
      const scope = yield* Scope.make()
      yield* session.hook.step(() => ({ compact: true })).pipe(Scope.provide(scope))
      expect(yield* session.runStep(stepInput())).toMatchObject({ compact: true })
      yield* Scope.close(scope, Exit.void)
      expect(yield* session.runStep(stepInput())).toBeUndefined()
    }),
  )
})
