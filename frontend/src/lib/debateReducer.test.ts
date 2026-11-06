import { describe, expect, it } from 'vitest'
import { debateReducer, initialDebateState, type DebateAction, type Verdict } from './debateReducer'

const score = { score: 5, why: 'ok' }
const VERDICT: Verdict = {
  recommendation: 'go',
  confidence: 0.6,
  scorecard: { market: score, customer_pull: score, feasibility: score, defensibility: score, timing: score },
  risks: [],
  experiments: [],
  one_line_summary: 'Build it.',
  fallback: false,
}

const FP = { score_1_to_10: 4, top_risk: 'Unit economics', change_mind_if: 'CAC under 30 dollars' }

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
      { type: 'turn_end', seq: 3, data: { turn_id: 't1', agent: 'vc', round: 1, text: 'final', final_position: FP } }])
    expect(s.turns.t1).toMatchObject({ text: 'final', status: 'done', finalPosition: FP })
  })

  it('handles setup, checkpoint, rebuttal, failure, verdict, error, done', () => {
    const s = run([
      { type: 'setup', seq: 1, data: { step: 'persona', message: 'Building persona', persona: { name: 'Ana' } } },
      { type: 'setup', seq: 2, data: { step: 'ready', message: 'Ready' } },
      { type: 'checkpoint', seq: 3, data: { round: 1, summary: 's', top_disagreements: ['a', 'b'] } },
      { type: 'await_rebuttal', seq: 4, data: { timeout_s: 60 } },
      { type: 'rebuttal_received', seq: 5, data: { text: 'hi' } },
      { type: 'turn_failed', seq: 6, data: { agent: 'cto', round: 2, note: 'timed out' } },
      { type: 'verdict', seq: 7, data: VERDICT },
      { type: 'error', seq: 8, data: { message: 'boom', recoverable: true } },
      { type: 'done', seq: 9, data: { status: 'complete' } },
    ])
    expect(s.setup.map((x) => x.step)).toEqual(['persona', 'ready'])
    expect(s.persona).toEqual({ name: 'Ana' })
    expect(s.checkpoints).toHaveLength(1)
    expect(s.awaitingRebuttal).toBeNull()
    expect(s.rebuttal).toBe('hi')
    expect(s.failures).toEqual([{ agent: 'cto', round: 2, note: 'timed out' }])
    expect(s.verdict).toEqual(VERDICT)
    expect(s.error).toEqual({ message: 'boom', recoverable: true })
    expect(s.status).toBe('complete')
  })

  it('turn_end for an unseen turn_id creates the finished turn', () => {
    const s = run([{ type: 'turn_end', seq: 1, data: { turn_id: 'z', agent: 'cto', round: 2, text: 'done', final_position: FP } }])
    expect(s.order).toEqual(['z'])
    expect(s.turns.z).toMatchObject({ agent: 'cto', round: 2, text: 'done', status: 'done', finalPosition: FP })
  })

  it('turn_token for an unseen turn_id is ignored', () => {
    const s = run([tok(1, 'orphan', 'ghost')])
    expect(s.turns).toEqual({})
    expect(s.order).toEqual([])
    expect(s.lastSeq).toBe(1)
  })

  it('a token arriving after turn_end does not change the finished text', () => {
    const s = run([start(1), { type: 'turn_end', seq: 2, data: { turn_id: 't1', agent: 'vc', round: 1, text: 'final' } }, tok(3, 'late')])
    expect(s.turns.t1.text).toBe('final')
    expect(s.turns.t1.status).toBe('done')
  })

  it('events with seq undefined are applied and never advance lastSeq', () => {
    const s = run([{ ...start(1), seq: undefined }, { ...tok(2, 'a'), seq: undefined }, { ...tok(3, 'b'), seq: undefined }])
    expect(s.turns.t1.text).toBe('ab')
    expect(s.lastSeq).toBe(0)
  })

  it('a repeated turn_start with attempt 2 resets text without duplicating the turn', () => {
    const s = run([start(1), tok(2, 'first try'),
      { type: 'turn_start', seq: 3, data: { turn_id: 't1', agent: 'vc', round: 1, attempt: 2 } }, tok(4, 'second')])
    expect(s.order).toEqual(['t1'])
    expect(s.turns.t1).toMatchObject({ attempt: 2, text: 'second', status: 'streaming' })
  })

  it('await_rebuttal opens the window', () => {
    const s = run([{ type: 'await_rebuttal', seq: 1, data: { timeout_s: 45 } }])
    expect(s.awaitingRebuttal).toEqual({ timeout_s: 45 })
  })

  it('turn_failed closes the matching streaming turn and keeps others open', () => {
    const s = run([
      start(1, 't1'),
      { type: 'turn_start', seq: 2, data: { turn_id: 't2', agent: 'cto', round: 1, attempt: 1 } },
      { type: 'turn_failed', seq: 3, data: { agent: 'vc', round: 1, note: 'gave up' } },
    ])
    expect(s.turns.t1.status).toBe('done')
    expect(s.turns.t2.status).toBe('streaming')
    expect(s.failures).toHaveLength(1)
  })

  it('tolerates a moderator turn_failed with no turn_start', () => {
    const s = run([{ type: 'turn_failed', seq: 1, data: { agent: 'moderator', round: 1, note: 'no summary' } }])
    expect(s.order).toEqual([])
    expect(s.failures).toEqual([{ agent: 'moderator', round: 1, note: 'no summary' }])
  })
})
