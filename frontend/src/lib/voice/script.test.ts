import { describe, expect, it } from 'vitest'
import { debateReducer, initialDebateState, type DebateAction, type DebateState, type Verdict } from '../debateReducer'
import type { DebateRecord } from '../api'
import { liveScript, replayScript } from './script'

const verdict: Verdict = {
  recommendation: 'pivot',
  confidence: 0.72,
  scorecard: {
    market: { score: 8, why: 'a' }, customer_pull: { score: 6, why: 'b' }, feasibility: { score: 7, why: 'c' },
    defensibility: { score: 3, why: 'd' }, timing: { score: 5, why: 'e' },
  },
  risks: [
    { rank: 2, risk: 'Second risk', severity: 'med', raised_by: 'CTO' },
    { rank: 1, risk: 'First risk.', severity: 'high', raised_by: 'VC' },
  ],
  experiments: [],
  one_line_summary: 'Narrow to emergency jobs first',
  fallback: false,
}

function play(actions: DebateAction[]): DebateState {
  return actions.reduce(debateReducer, initialDebateState)
}

describe('liveScript', () => {
  it('speaks finished turns in order, with a round title before each new round and a short checkpoint', () => {
    const state = play([
      { type: 'turn_start', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, attempt: 1 } },
      { type: 'turn_end', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, text: 'Investor says.' } },
      { type: 'turn_start', data: { turn_id: 'r1-cto', agent: 'cto', round: 1, attempt: 1 } },
      { type: 'turn_end', data: { turn_id: 'r1-cto', agent: 'cto', round: 1, text: 'Engineer says.' } },
      { type: 'checkpoint', data: { round: 1, summary: 'They disagree', top_disagreements: ['Price', 'Trust'] } },
      { type: 'turn_start', data: { turn_id: 'r2-vc', agent: 'vc', round: 2, attempt: 1 } },
      { type: 'turn_end', data: { turn_id: 'r2-vc', agent: 'vc', round: 2, text: 'Round two.' } },
    ])
    expect(liveScript(state).map((l) => [l.voice, l.text])).toEqual([
      ['moderator', 'Round 1.'],
      ['vc', 'Investor says.'],
      ['cto', 'Engineer says.'],
      ['moderator', 'End of round 1. They disagree.'],
      ['moderator', 'Round 2.'],
      ['vc', 'Round two.'],
    ])
  })

  it('waits for a streaming turn and anything after it, so the order never changes', () => {
    const state = play([
      { type: 'turn_start', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, attempt: 1 } },
      { type: 'turn_token', data: { turn_id: 'r1-vc', text: 'Half a thou' } },
    ])
    expect(liveScript(state)).toEqual([])
  })

  it('skips a turn that failed with no text', () => {
    const state = play([
      { type: 'turn_start', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, attempt: 1 } },
      { type: 'turn_failed', data: { agent: 'vc', round: 1, note: 'The investor lost the thread.' } },
      { type: 'turn_start', data: { turn_id: 'r1-cto', agent: 'cto', round: 1, attempt: 1 } },
      { type: 'turn_end', data: { turn_id: 'r1-cto', agent: 'cto', round: 1, text: 'Still here.' } },
    ])
    expect(liveScript(state).map((l) => l.text)).toEqual(['Round 1.', 'Still here.'])
  })
})

describe('replayScript', () => {
  const debate: DebateRecord = {
    id: 'abc',
    pitch: 'Electricians on demand',
    status: 'complete',
    rebuttal: 'We already have 40 electricians signed.',
    verdict,
    turns: [
      // Stored out of order on purpose: the replay follows the row ids.
      { id: 4, round: 1, agent: 'moderator', text: 'Round one summary.', details: { top_disagreements: ['Price', 'Trust'] } },
      { id: 1, round: 1, agent: 'vc', text: 'VC round one.', details: null },
      { id: 2, round: 1, agent: 'customer', text: 'Customer round one.', details: null },
      { id: 5, round: 2, agent: 'competitor', text: 'Rival round two.', details: null },
    ],
  }

  it('plays intro, rounds, checkpoint, rebuttal, then the verdict, all from stored text', () => {
    const lines = replayScript(debate)
    expect(lines.map((l) => [l.voice, l.text])).toEqual([
      ['moderator', "Startup War Room. Tonight's pitch. Electricians on demand."],
      ['moderator', 'Round 1.'],
      ['vc', 'VC round one.'],
      ['customer', 'Customer round one.'],
      ['moderator', 'End of round 1. Round one summary. The top disagreements. Price. Trust.'],
      ['founder', 'We already have 40 electricians signed.'],
      ['moderator', 'Round 2.'],
      ['competitor', 'Rival round two.'],
      ['moderator', 'The verdict. Pivot. Confidence 72 percent. Narrow to emergency jobs first. The top risks. First risk. Second risk.'],
    ])
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length)
    expect(lines.find((l) => l.voice === 'founder')?.who).toBe('Founder')
  })

  it('leaves out the rebuttal and verdict when there are none', () => {
    const lines = replayScript({ ...debate, rebuttal: null, verdict: null })
    expect(lines.some((l) => l.voice === 'founder')).toBe(false)
    expect(lines.at(-1)?.text).toBe('Rival round two.')
  })

  it('puts a rebuttal at the end when the debate stopped before round 2', () => {
    const lines = replayScript({ ...debate, verdict: null, turns: debate.turns!.slice(0, 3) })
    expect(lines.at(-1)?.voice).toBe('founder')
  })
})
