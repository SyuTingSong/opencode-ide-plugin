import type { Hooks } from "./registration.js"

/**
 * The model resolved for the next provider turn, structural subset of the
 * `Model` class exposed by the engine so plugins can read context limits.
 */
export interface SessionStepModel {
  readonly id: string
  readonly provider: string
  readonly route: {
    readonly defaults?: {
      readonly limits?: {
        readonly context?: number
        readonly output?: number
      }
    }
  }
}

/**
 * The provider request built for the next turn, structural subset of the
 * engine's request model. Messages and tools stay opaque; serialize them to
 * estimate token counts.
 */
export interface SessionStepRequest {
  readonly model: SessionStepModel
  readonly system: readonly unknown[]
  readonly messages: readonly unknown[]
  readonly tools: readonly unknown[]
}

/** A persisted compaction message; serves as the cooldown anchor. */
export interface SessionStepCompactionMessage {
  readonly id: string
  readonly type: "compaction"
  readonly summary: string
  readonly recent: string
}

/** An assistant message; tool-call parts (e.g. todowrite) live in `content`. */
export interface SessionStepAssistantMessage {
  readonly id: string
  readonly type: "assistant"
  readonly content: readonly unknown[]
}

/** Any other message type; access fields through narrowing or casts. */
export interface SessionStepOtherMessage {
  readonly id: string
  readonly type: string
  readonly [property: string]: unknown
}

/** A projected session message, structural subset of the engine's message model. */
export type SessionStepMessage =
  | SessionStepCompactionMessage
  | SessionStepAssistantMessage
  | SessionStepOtherMessage

/** One persisted session message and its history sequence, as seen at a safe step boundary. */
export interface SessionStepEntry {
  readonly seq: number
  readonly message: SessionStepMessage
}

/**
 * Snapshot of the next provider turn at a safe step boundary, offered before
 * the engine streams it. Plugins estimate exact token counts from the built
 * request and derive plan transitions, tool-output ratios, and the last
 * compaction anchor from the projected history entries.
 */
export interface SessionStepInput {
  readonly sessionID: string
  /** The provider-turn step about to stream; resets to 1 after a user promotion. */
  readonly step: number
  readonly model: SessionStepModel
  readonly request: SessionStepRequest
  readonly entries: readonly SessionStepEntry[]
}

/** A plugin's verdict for the current step boundary. */
export interface SessionStepResult {
  /** Request compaction at this boundary. The engine reuses its safe compaction path. */
  readonly compact: boolean
  /** Reason surfaced on the compaction events; defaults to "auto". */
  readonly reason?: string
}

export type SessionHooks = Hooks<{ step: SessionStepInput }, SessionStepResult>
