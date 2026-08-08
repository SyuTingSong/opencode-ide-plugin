export * as PluginSession from "./session"

import type { SessionStepInput, SessionStepResult } from "@opencode-ai/plugin/v2/effect"
import { makeLocationNode } from "../effect/app-node"
import { State } from "../state"
import { Context, Effect, Layer, Scope } from "effect"

type StepHook = (input: SessionStepInput) => Effect.Effect<SessionStepResult> | SessionStepResult

export interface Interface {
  readonly hook: {
    readonly step: (callback: StepHook) => Effect.Effect<State.Registration, never, Scope.Scope>
  }
  /** Runs every registered step hook in order and returns the first compaction request. */
  readonly runStep: (input: SessionStepInput) => Effect.Effect<SessionStepResult | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/PluginSession") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let stepHooks: StepHook[] = []

    const register = Effect.fn("PluginSession.hook.step")(function* (callback: StepHook) {
      const scope = yield* Scope.Scope
      let active = true
      stepHooks = [...stepHooks, callback]
      const dispose = Effect.sync(() => {
        if (!active) return
        active = false
        stepHooks = stepHooks.filter((item) => item !== callback)
      })
      yield* Scope.addFinalizer(scope, dispose)
      return { dispose }
    })

    const runStep = Effect.fnUntraced(function* (input: SessionStepInput) {
      for (const hook of stepHooks) {
        const result = hook(input)
        const settled = Effect.isEffect(result) ? yield* result : result
        if (settled.compact) return settled
      }
      return undefined
    })

    return Service.of({
      hook: {
        step: register,
      },
      runStep,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer: locationLayer, deps: [] })
