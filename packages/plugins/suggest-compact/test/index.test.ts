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

const record = async (host: Awaited<ReturnType<typeof boot>>, reason: string): Promise<{ _tag: string; value?: unknown }> => {
  const tool = host.tools.get("suggest_compact") as { execute: (input: unknown, ctx: unknown) => Effect.Effect<unknown, unknown> }
  return await Effect.runPromiseExit(tool.execute({ reason }, toolContext))
}

const suggestion: { compact: true; reason: string } = { compact: true, reason: "other-plugin" }

const step = (overrides: {
  n: number
  chars?: number
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
    entries: overrides.entries ?? [],
    result: overrides.result,
  }) as unknown as SessionStep

const boundary = async (host: Awaited<ReturnType<typeof boot>>, event: SessionStep) => {
  for (const hook of host.stepHooks) await Effect.runPromise(hook(event))
  return event
}

const compactionEntry = (id: string) => ({ type: "compaction", id, time: { created: 0 } })

describe("suggest-compact", () => {
  test("boot registers the tool and the step hook", async () => {
    const host = await boot()
    expect(suggestCompact.id).toBe("suggest-compact")
    expect(host.tools.has("suggest_compact")).toBe(true)
    expect(host.stepHooks).toHaveLength(1)
  })

  test("records a suggestion and consumes it once at the pass boundary", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100" })

    let event = await boundary(host, step({ n: 1, chars: 1_000 }))
    expect(event.result?.compact).toBeUndefined()

    const run = await record(host, "stage boundary")
    expect(run._tag).toBe("Success")
    expect((run as { value: { output: { received: boolean } } }).value.output).toEqual({ received: true })

    event = await boundary(host, step({ n: 2, chars: 1_000 }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })

    event = await boundary(host, step({ n: 3, chars: 1_000 }))
    expect(event.result?.compact).toBeUndefined()
  })

  test("rejects a suggestion below the token gate and drops it", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "1000" })
    await record(host, "stage boundary")

    let event = await boundary(host, step({ n: 1, chars: 100 }))
    expect(event.result?.compact).toBeUndefined()

    event = await boundary(host, step({ n: 2, chars: 10_000 }))
    expect(event.result?.compact).toBeUndefined()
  })

  test("rejects during cooldown and approves once the window passes", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100", OPENCODE_SUGGEST_COOLDOWN_STEPS: "2" })

    await record(host, "anchor observation")
    await boundary(host, step({ n: 3, chars: 1_000, entries: [compactionEntry("msg_old")] }))
    await record(host, "too soon")
    let event = await boundary(host, step({ n: 4, chars: 1_000, entries: [compactionEntry("msg_old")] }))
    expect(event.result?.compact).toBeUndefined()

    await record(host, "window passed")
    event = await boundary(host, step({ n: 5, chars: 1_000, entries: [compactionEntry("msg_old")] }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })

  test("resets the cooldown anchor when the compaction identity changes", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100", OPENCODE_SUGGEST_COOLDOWN_STEPS: "2" })

    await record(host, "lost to the old cooldown")
    await boundary(host, step({ n: 3, chars: 1_000, entries: [compactionEntry("msg_old")] }))

    // Without a reset the distance from the old anchor would exceed the cooldown.
    await record(host, "fresh cooldown")
    let event = await boundary(host, step({ n: 12, chars: 1_000, entries: [compactionEntry("msg_new")] }))
    expect(event.result?.compact).toBeUndefined()

    // The counter keeps ticking on boundaries without a pending suggestion.
    await boundary(host, step({ n: 13, chars: 1_000, entries: [compactionEntry("msg_new")] }))

    await record(host, "window passed")
    event = await boundary(host, step({ n: 14, chars: 1_000, entries: [compactionEntry("msg_new")] }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })

  test("cooldown survives run boundaries despite run-local step numbers", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100", OPENCODE_SUGGEST_COOLDOWN_STEPS: "2" })

    // Run A: the hook anchors the observed compaction at its run-local step 4.
    await record(host, "anchor in run A")
    await boundary(host, step({ n: 4, chars: 1_000, entries: [compactionEntry("msg_c")] }))

    // Run B restarts at step 1; comparing run-local numbers gives 2 - 4 = -2,
    // which held the suggestion in cooldown forever.
    await record(host, "suggested in run B")
    let event = await boundary(host, step({ n: 1, chars: 1_000, entries: [compactionEntry("msg_c")] }))
    expect(event.result?.compact).toBeUndefined()

    await record(host, "window passed in run B")
    event = await boundary(host, step({ n: 2, chars: 1_000, entries: [compactionEntry("msg_c")] }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })

  test("keeps the pending signal when compaction is already requested", async () => {
    const host = await boot({ OPENCODE_SUGGEST_MIN_TOKENS: "100" })
    await record(host, "already asked")

    let event = await boundary(host, step({ n: 1, chars: 1_000, result: suggestion }))
    expect(event.result).toEqual(suggestion)
    event = await boundary(host, step({ n: 2, chars: 1_000 }))
    expect(event.result).toEqual({ compact: true, reason: "suggest" })
  })
})
