import type { AgentId } from '../debateReducer'

/** Who is speaking. The moderator doubles as the ring announcer; the founder reads their own rebuttal. */
export type VoiceRole = AgentId | 'founder'

/** One spoken line: always real text from the debate, plus the fixed framing a ring announcer adds. */
export interface Line {
  /** Stable across re-renders, so captions and the queue can follow a line. */
  key: string
  voice: VoiceRole
  /** The caption's speaker name. */
  who: string
  round?: number
  text: string
}

/**
 * Why a chunk did not play.
 *   load     the engine itself is unusable (the HD model did not load): switch engines
 *   chunk    this one chunk failed to render or play: retry it once, then skip it
 *   blocked  the browser refused to make sound without a fresh tap (Safari's play() NotAllowedError)
 */
export type VoiceErrorKind = 'load' | 'chunk' | 'blocked'

export class VoiceError extends Error {
  readonly kind: VoiceErrorKind
  constructor(kind: VoiceErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/** One chunk being spoken. `done` resolves when it finishes on its own, and also when it is stopped. */
export interface SpeakHandle {
  done: Promise<void>
  /** Resolves when sound actually starts. Absent means it starts at once. HD uses it while a chunk renders. */
  started?: Promise<void>
  stop(): void
  pause(): void
  resume(): void
  setRate(rate: number): void
}

export interface VoiceEngine {
  readonly kind: 'instant' | 'hd'
  speak(text: string, voice: VoiceRole, rate: number): SpeakHandle
  /** Optional render-ahead for a chunk that is coming soon. */
  prepare?(text: string, voice: VoiceRole): void
  /** Drops all render-ahead work. Called on stop and on every skip. */
  cancel?(): void
  dispose(): void
}
