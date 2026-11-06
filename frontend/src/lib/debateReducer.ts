export type AgentId = 'vc' | 'customer' | 'cto' | 'competitor' | 'moderator'
export const AGENTS: AgentId[] = ['vc', 'customer', 'cto', 'competitor', 'moderator']

export type SetupStep = 'persona' | 'competitors' | 'ready'
export interface ScoreItem { score: number; why: string }
export interface Scorecard {
  market: ScoreItem
  customer_pull: ScoreItem
  feasibility: ScoreItem
  defensibility: ScoreItem
  timing: ScoreItem
}
export interface Risk { rank: number; risk: string; severity: 'high' | 'med' | 'low'; raised_by: string }
export interface Experiment { test: string; timebox_days: number; success_criteria: string; kill_criteria: string }
/** Mirrors backend/app/models.py `Verdict`. */
export interface Verdict {
  recommendation: 'go' | 'pivot' | 'no_go'
  confidence: number
  scorecard: Scorecard
  risks: Risk[]
  experiments: Experiment[]
  one_line_summary: string
  fallback: boolean
}

export interface SetupData { step: SetupStep; message: string; persona?: unknown; competitors?: unknown }

/** Discriminated union: one member per event in the SSE contract. `seq` is the SSE `id`. */
export type DebateAction = { seq?: number } & (
  | { type: 'setup'; data: SetupData }
  | { type: 'turn_start'; data: { turn_id: string; agent: AgentId; round: number; attempt: number } }
  | { type: 'turn_token'; data: { turn_id: string; text: string } }
  | { type: 'turn_reset'; data: { turn_id: string; reason: string } }
  | { type: 'turn_end'; data: { turn_id: string; agent: AgentId; round: number; text: string; final_position?: string } }
  | { type: 'turn_failed'; data: { agent: AgentId; round: number; note: string } }
  | { type: 'checkpoint'; data: { round: number; summary: string; top_disagreements: [string, string] } }
  | { type: 'await_rebuttal'; data: { timeout_s: number } }
  | { type: 'rebuttal_received'; data: { text: string | null } }
  | { type: 'verdict'; data: Verdict }
  | { type: 'error'; data: { message: string; recoverable: boolean } }
  | { type: 'done'; data: { status: string } }
)

export type DebateEventName = DebateAction['type']

export interface Turn {
  id: string
  agent: AgentId
  round: number
  attempt: number
  text: string
  status: 'streaming' | 'done'
  finalPosition?: string
}

export interface DebateState {
  lastSeq: number
  status: 'connecting' | 'running' | 'complete' | string
  setup: SetupData[]
  persona: unknown
  competitors: unknown
  turns: Record<string, Turn>
  order: string[]
  failures: { agent: AgentId; round: number; note: string }[]
  checkpoints: { round: number; summary: string; top_disagreements: [string, string] }[]
  awaitingRebuttal: { timeout_s: number } | null
  rebuttal: string | null
  verdict: Verdict | null
  error: { message: string; recoverable: boolean } | null
}

export const initialDebateState: DebateState = {
  lastSeq: 0,
  status: 'connecting',
  setup: [],
  persona: null,
  competitors: null,
  turns: {},
  order: [],
  failures: [],
  checkpoints: [],
  awaitingRebuttal: null,
  rebuttal: null,
  verdict: null,
  error: null,
}

export function debateReducer(state: DebateState, action: DebateAction): DebateState {
  // Replays (EventSource reconnect sends Last-Event-ID; server may resend) carry a seen seq.
  if (action.seq !== undefined) {
    if (action.seq <= state.lastSeq) return state
    state = { ...state, lastSeq: action.seq }
  }

  switch (action.type) {
    case 'setup':
      return {
        ...state,
        status: 'running',
        setup: [...state.setup, action.data],
        persona: action.data.persona ?? state.persona,
        competitors: action.data.competitors ?? state.competitors,
      }
    case 'turn_start': {
      const { turn_id, agent, round, attempt } = action.data
      const prev = state.turns[turn_id]
      return {
        ...state,
        status: 'running',
        awaitingRebuttal: null,
        turns: { ...state.turns, [turn_id]: { id: turn_id, agent, round, attempt, text: '', status: 'streaming' } },
        order: prev ? state.order : [...state.order, turn_id],
      }
    }
    case 'turn_token': {
      const turn = state.turns[action.data.turn_id]
      // Tokens carry no agent/round, so an unseen turn cannot be created from one; late tokens after turn_end are stale.
      if (!turn || turn.status === 'done') return state
      return { ...state, turns: { ...state.turns, [turn.id]: { ...turn, text: turn.text + action.data.text } } }
    }
    case 'turn_reset': {
      const turn = state.turns[action.data.turn_id]
      if (!turn) return state
      return { ...state, turns: { ...state.turns, [turn.id]: { ...turn, text: '', status: 'streaming' } } }
    }
    case 'turn_end': {
      const { turn_id, agent, round, text, final_position } = action.data
      const turn: Turn = state.turns[turn_id] ?? { id: turn_id, agent, round, attempt: 1, text, status: 'done' }
      return {
        ...state,
        turns: { ...state.turns, [turn_id]: { ...turn, text, status: 'done', finalPosition: final_position } },
        order: state.turns[turn_id] ? state.order : [...state.order, turn_id],
      }
    }
    case 'turn_failed':
      return { ...state, failures: [...state.failures, action.data] }
    case 'checkpoint':
      return { ...state, checkpoints: [...state.checkpoints, action.data] }
    case 'await_rebuttal':
      return { ...state, awaitingRebuttal: action.data }
    case 'rebuttal_received':
      return { ...state, awaitingRebuttal: null, rebuttal: action.data.text }
    case 'verdict':
      return { ...state, verdict: action.data }
    case 'error':
      return { ...state, error: action.data }
    case 'done':
      return { ...state, status: action.data.status, awaitingRebuttal: null }
  }
}
