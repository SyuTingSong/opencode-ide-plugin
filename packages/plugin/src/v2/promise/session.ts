import type {
  SessionStepEntry,
  SessionStepInput,
  SessionStepResult,
} from "../effect/session.js"
import type { Hooks } from "./registration.js"

export type { SessionStepEntry, SessionStepInput, SessionStepResult }

export type SessionHooks = Hooks<{ step: SessionStepInput }, SessionStepResult>
