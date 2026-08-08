import type { Effect, Scope } from "effect"

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export interface Reload {
  readonly reload: () => Effect.Effect<void>
}

export type Hooks<Spec, Return = void> = {
  readonly [Name in keyof Spec]: (
    callback: (input: Spec[Name]) => Effect.Effect<Return> | Return,
  ) => Effect.Effect<Registration, never, Scope.Scope>
}
