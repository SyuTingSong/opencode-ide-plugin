export interface Registration {
  readonly dispose: () => Promise<void>
}

export interface Reload {
  readonly reload: () => Promise<void>
}

export type Hooks<Spec, Return = void> = {
  readonly [Name in keyof Spec]: (
    callback: (input: Spec[Name]) => Promise<Return> | Return,
  ) => Promise<Registration>
}
