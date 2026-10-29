import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionStep } from "@opencode/plugin/effect/session"
import { Effect } from "effect"
import { describe, expect, test } from "bun:test"
import suggestCompact from "../index.ts"

/** Minimal fake host: only the two surfaces the plugin touches. */
const makeHost = () => {
  const tools = new Map<string, Record<string, unknown>>()
  const stepHooks: Array<(event: SessionStep) => Effect.Effect<void>> = []
  const editor = {
    list: () => [],
    get: (_id: string) => undefined,
    namespace: (_ns: unknown) => {},
    add: (tool: { name: string }) => {
      tools.set(tool.name, tool)
    },
    update: (_id: string, _update: (tool: never) => void) => {},
    remove: (_id: string) => {},
  }
  const ctx = {
    tool: {
      transform: (callback: (e: unknown) => void) =>
        Effect.sync(() => callback(editor)).pipe(Effect.as({ dispose: Effect.void })),
    },
    session: {
      hook: (name: string, callback: (event: SessionStep) => Effect.Effect<void>) => {
        if (name === "step") stepHooks.push(callback)
        return Effect.succeed({ dispose: Effect.void })
      },
    },
  } as unknown as Context
  return { ctx, tools, stepHooks }
}

// Env knobs are read once per plugin activation; stub them around the boot.
async function boot(env: Record<string, string> = {}) {
  const host = makeHost()
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  try {
    await Effect.runPromise(Effect.scoped(suggestCompact.effect(host.ctx)))
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  return host
}

const toolContext = { sessionID: "ses_test", agent: "build", messageID: "msg_1", id: "c1", progress: () => Effect.void }

const record = async (host: Awaited<ReturnType<typeof boot>>): Promise<{ _tag: string; value?: unknown }> => {
  const tool = host.tools.get("suggest_compact") as { execute: (input: unknown, ctx: unknown) => Effect.Effect<unknown, unknown> }
  return await Effect.runPromiseExit(tool.execute({}, toolContext))
}

const suggestion: { compact: true; reason: string } = { compact: true, reason: "other-plugin" }

const step = (overrides: {
  n: number
  chars?: number
  contextTokens?: number
  entries?: ReadonlyArray<unknown>
  result?: { compact: true; reason: string }
}): SessionStep =>
  ({
    sessionID: "ses_test",
    agent: "build",
    step: overrides.n,
    model: { providerID: "test", id: "test" },
    request: {
      system: [{ type: "text", text: "x".repeat(overrides.chars ?? 0) }],
      messages: [],
      tools: {},
    },
    // The engine's estimate; chars / 4 keeps the legacy heuristic meaning of `chars`.
    contextTokens: overrides.contextTokens ?? Math.round((overrides.chars ?? 0) / 4),
    entries: overrides.entries ?? [],
    result: overrides.result,
  }) as unknown as SessionStep

const boundary = async (host: Awaited<ReturnType<typeof boot>>, event: SessionStep) => {
  for (const hook of host.stepHooks) await Effect.runPromise(hook(event))
  return event
}

const compactionEntry = (id: string, status = "completed") => ({ type: "compaction", id, status, time: { created: 0 } })

const assistantEntry = (id: string) => ({ type: "assistant", id, time: { created: 0 } })

/** A projected history: the compaction anchor followed by `steps` provider steps. */
const after = (compactionID: string, steps: number, ...tail: ReadonlyArray<unknown>) => [
  compactionEntry(compactionID),
  ...Array.from({ length: steps }, (_, i) => assistantEntry(`msg_step${i}`)),
  ...tail,
]

describe("suggest-compact", () => {
  test("boot registers the tool and the step hook", async () => {
    const host = await boot()
    expect(suggestCompact.id).toBe("suggest-compact")
    expect(host.tools.has("suggest_compact")).toBe(true)
    // Native tool list (not the Code Mode catalog), so the description is fully
    // visible and callable without routing through `execute`.
    expect((host.tools.get("suggest_compact") as { options?: { codemode: boolean } }).options).toEqual({
      codemode: false,
    })
    expect(host.stepHooks).toHaveLength(1)
  })

  test("records a suggestion and consumes it once at the pass boundary", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100" })

    let event = await boundary(host, step({ n: 1, chars: 1_000 }))
    expect(event.result?.compact).toBeUndefined()

    const run = await record(host)
    expect(run._tag).toBe("Success")
    expect((run as { value: { output: { received: boolean } } }).value.output).toEqual({ received: true })

    event = await boundary(host, step({ n: 2, chars: 1_000 }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })

    event = await boundary(host, step({ n: 3, chars: 1_000 }))
    expect(event.result?.compact).toBeUndefined()
  })

  test("rejects a suggestion below the token gate and drops it", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "1000" })
    await record(host)

    let event = await boundary(host, step({ n: 1, chars: 100 }))
    expect(event.result?.compact).toBeUndefined()

    event = await boundary(host, step({ n: 2, chars: 10_000 }))
    expect(event.result?.compact).toBeUndefined()
  })

  test("gates on the engine's context estimate, not the serialized request", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "1000" })
    await record(host)

    // 40k chars would read as ~10k tokens under the serialized-length heuristic;
    // the engine's number says 900 and must decide.
    let event = await boundary(host, step({ n: 1, chars: 40_000, contextTokens: 900 }))
    expect(event.result?.compact).toBeUndefined()

    await record(host)
    event = await boundary(host, step({ n: 2, chars: 40, contextTokens: 1_500 }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })

  test("falls back to the serialized request when the core predates contextTokens", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "1000" })
    await record(host)

    const event = await boundary(host, {
      ...step({ n: 1, chars: 10_000 }),
      contextTokens: undefined,
    } as unknown as SessionStep)
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })

  test("rejects during cooldown and approves once the window passes", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100", OPENCODE_SUGGEST_COOLDOWN_STEPS: "2" })

    await record(host)
    let event = await boundary(host, step({ n: 4, chars: 1_000, entries: after("msg_c", 1) }))
    expect(event.result?.compact).toBeUndefined()

    await record(host)
    event = await boundary(host, step({ n: 5, chars: 1_000, entries: after("msg_c", 2) }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })

  test("approves the first suggestion observed after a compaction", async () => {
    // The anchor is derived from the offered history on every boundary, so the
    // first post-compaction suggestion measures the real elapsed steps instead
    // of a counter stamped at observation (which always saw distance zero).
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100", OPENCODE_SUGGEST_COOLDOWN_STEPS: "2" })

    await record(host)
    const event = await boundary(host, step({ n: 9, chars: 1_000, entries: after("msg_c", 4) }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })

  test("a fresh compaction entry restarts the cooldown window", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100", OPENCODE_SUGGEST_COOLDOWN_STEPS: "2" })

    await record(host)
    let event = await boundary(host, step({ n: 12, chars: 1_000, entries: after("msg_old", 5) }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })

    await record(host)
    event = await boundary(host, step({ n: 13, chars: 1_000, entries: after("msg_new", 0) }))
    expect(event.result?.compact).toBeUndefined()
  })

  test("measures cooldown from history, so a restart keeps the window", async () => {
    const first = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100", OPENCODE_SUGGEST_COOLDOWN_STEPS: "2" })
    await record(first)
    await boundary(first, step({ n: 4, chars: 1_000, entries: after("msg_c", 1) }))

    // A restarted plugin instance has empty in-memory state, yet the same
    // history yields the same window regardless of run-local step numbers.
    const restarted = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100", OPENCODE_SUGGEST_COOLDOWN_STEPS: "2" })
    await record(restarted)
    let event = await boundary(restarted, step({ n: 1, chars: 1_000, entries: after("msg_c", 1) }))
    expect(event.result?.compact).toBeUndefined()

    await record(restarted)
    event = await boundary(restarted, step({ n: 1, chars: 1_000, entries: after("msg_c", 2) }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })

  test("anchors on the last completed compaction, ignoring failures", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100", OPENCODE_SUGGEST_COOLDOWN_STEPS: "2" })

    await record(host)
    const event = await boundary(host, step({
      n: 6,
      chars: 1_000,
      entries: [...after("msg_old", 4), compactionEntry("msg_failed", "failed"), assistantEntry("msg_latest")],
    }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })

  test("keeps the pending signal when compaction is already requested", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100" })
    await record(host)

    let event = await boundary(host, step({ n: 1, chars: 1_000, result: suggestion }))
    expect(event.result).toEqual(suggestion)
    event = await boundary(host, step({ n: 2, chars: 1_000 }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })
})
