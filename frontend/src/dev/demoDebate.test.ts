import { describe, expect, it } from 'vitest'
import { debateReducer, initialDebateState, type DebateAction, type DebateState } from '../lib/debateReducer'
import { demoScript, demoVerdict } from './demoDebate'

const ALL_EVENTS = ['setup', 'turn_start', 'turn_token', 'turn_reset', 'turn_end', 'turn_failed', 'checkpoint', 'await_rebuttal', 'rebuttal_received', 'verdict', 'error', 'done']

describe('demo debate script', () => {
  const steps = demoScript()
  it('covers every event type in the SSE contract', () => {
    const seen = new Set(steps.map((s) => s.action.type))
    for (const t of ALL_EVENTS) expect(seen.has(t as DebateAction['type']), t).toBe(true)
  })
  it('numbers events in increasing order, like the server does', () => {
    const seqs = steps.map((s) => s.action.seq!)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
  })
  it('runs through the real reducer to a finished debate with a verdict and a rebuttal window', () => {
    let opened = false
    const end = steps.reduce<DebateState>((s, st) => {
      const next = debateReducer(s, st.action)
      if (next.awaitingRebuttal) opened = true
      return next
    }, initialDebateState)
    expect(opened).toBe(true)
    expect(end.status).toBe('complete')
    expect(end.verdict?.recommendation).toBeTruthy()
    expect(end.checkpoints.length).toBeGreaterThanOrEqual(2)
    expect(Object.values(end.turns).some((t) => t.finalPosition)).toBe(true)
  })
  it('only shows scores from round 3 or the verdict', () => {
    const early = steps.filter((s) => s.action.type === 'turn_end' && s.action.data.round < 3)
    for (const s of early) if (s.action.type === 'turn_end') expect(s.action.data.final_position).toBeUndefined()
  })
  it('offers go, pivot, no_go and partial verdicts', () => {
    expect(demoVerdict('go').recommendation).toBe('go')
    expect(demoVerdict('no_go').recommendation).toBe('no_go')
    expect(demoVerdict('partial').fallback).toBe(true)
    expect(demoVerdict('pivot').risks).toHaveLength(5)
    expect(demoVerdict('pivot').experiments).toHaveLength(3)
  })
})
