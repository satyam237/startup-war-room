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

/** One chunk being spoken. `done` resolves when it finishes on its own, and also when it is stopped. */
export interface SpeakHandle {
  done: Promise<void>
  stop(): void
  pause(): void
  resume(): void
  setRate(rate: number): void
}

export interface VoiceEngine {
  readonly kind: 'instant' | 'hd'
  speak(text: string, voice: VoiceRole, rate: number): SpeakHandle
  /** Optional warm-up for a chunk that is coming next. */
  prepare?(text: string, voice: VoiceRole): void
  dispose(): void
}
