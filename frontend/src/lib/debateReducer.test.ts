import { describe, expect, it } from 'vitest'
import { debateReducer, initialDebateState, type DebateAction } from './debateReducer'

const run = (actions: DebateAction[]) => actions.reduce(debateReducer, initialDebateState)
const start = (seq: number, turn_id = 't1'): DebateAction => ({
  type: 'turn_start', seq, data: { turn_id, agent: 'vc', round: 1, attempt: 1 },
})
const tok = (seq: number, text: string, turn_id = 't1'): DebateAction => ({
  type: 'turn_token', seq, data: { turn_id, text },
})

describe('debateReducer', () => {
  it('accumulates tokens per turn_id', () => {
    const s = run([start(1), start(2, 't2'), tok(3, 'Hel'), tok(4, 'lo'), tok(5, 'X', 't2')])
    expect(s.turns.t1.text).toBe('Hello')
    expect(s.turns.t2.text).toBe('X')
    expect(s.order).toEqual(['t1', 't2'])
  })

  it('turn_reset clears only that turn', () => {
    const s = run([start(1), start(2, 't2'), tok(3, 'abc'), tok(4, 'def', 't2'),
      { type: 'turn_reset', seq: 5, data: { turn_id: 't1', reason: 'repetition' } }, tok(6, 'new')])
    expect(s.turns.t1.text).toBe('new')
    expect(s.turns.t2.text).toBe('def')
  })

  it('ignores replayed events with a seen seq', () => {
    const s = run([start(1), tok(2, 'a'), tok(3, 'b'), tok(2, 'a'), tok(3, 'b')])
    expect(s.turns.t1.text).toBe('ab')
    expect(s.lastSeq).toBe(3)
  })

  it('turn_end sets final text and position', () => {
    const s = run([start(1), tok(2, 'draft'),
      { type: 'turn_end', seq: 3, data: { turn_id: 't1', agent: 'vc', round: 1, text: 'final', final_position: 'pass' } }])
    expect(s.turns.t1).toMatchObject({ text: 'final', status: 'done', finalPosition: 'pass' })
  })

  it('handles setup, checkpoint, rebuttal, failure, verdict, error, done', () => {
    const s = run([
      { type: 'setup', seq: 1, data: { step: 'persona', message: 'Building persona', persona: { name: 'Ana' } } },
      { type: 'setup', seq: 2, data: { step: 'ready', message: 'Ready' } },
      { type: 'checkpoint', seq: 3, data: { round: 1, summary: 's', top_disagreements: ['a', 'b'] } },
      { type: 'await_rebuttal', seq: 4, data: { timeout_s: 60 } },
      { type: 'rebuttal_received', seq: 5, data: { text: 'hi' } },
      { type: 'turn_failed', seq: 6, data: { agent: 'cto', round: 2, note: 'timed out' } },
      { type: 'verdict', seq: 7, data: { recommendation: 'go' } },
      { type: 'error', seq: 8, data: { message: 'boom', recoverable: true } },
      { type: 'done', seq: 9, data: { status: 'complete' } },
    ])
    expect(s.setup.map((x) => x.step)).toEqual(['persona', 'ready'])
    expect(s.persona).toEqual({ name: 'Ana' })
    expect(s.checkpoints).toHaveLength(1)
    expect(s.awaitingRebuttal).toBeNull()
    expect(s.rebuttal).toBe('hi')
    expect(s.failures).toEqual([{ agent: 'cto', round: 2, note: 'timed out' }])
    expect(s.verdict).toEqual({ recommendation: 'go' })
    expect(s.error).toEqual({ message: 'boom', recoverable: true })
    expect(s.status).toBe('complete')
  })

  it('await_rebuttal opens the window', () => {
    const s = run([{ type: 'await_rebuttal', seq: 1, data: { timeout_s: 45 } }])
    expect(s.awaitingRebuttal).toEqual({ timeout_s: 45 })
  })
})
