/**
 * What gets said, in order. Every line is real text from the stream or the stored debate. The only words
 * added are the announcer's fixed framing ("Round 2.", "End of round 1.", "The verdict."), never content.
 */
import type { AgentId, CheckpointNote, DebateState, Verdict } from '../debateReducer'
import type { DebateRecord } from '../api'
import { AGENT_NAME } from '../../components/agentInfo'
import type { Line } from './types'

const CALL: Record<Verdict['recommendation'], string> = { go: 'Go', pivot: 'Pivot', no_go: 'No go' }

/** Ends a fragment with a full stop if it has no closing punctuation, so the voice pauses between items. */
const stop = (s: string) => {
  const t = s.trim()
  return /[.!?…]["'”’)\]]*$/.test(t) ? t : `${t}.`
}

const announce = (key: string, text: string, round?: number): Line => ({ key, voice: 'moderator', who: AGENT_NAME.moderator, round, text })
const roundTitle = (round: number) => announce(`round-${round}`, `Round ${round}.`, round)
const turnLine = (key: string, agent: AgentId, round: number, text: string): Line => ({ key, voice: agent, who: AGENT_NAME[agent], round, text })

function checkpointLine(cp: CheckpointNote, withDisagreements: boolean): Line {
  const parts = [`End of round ${cp.round}.`, stop(cp.summary)]
  const points = (cp.top_disagreements ?? []).filter((d) => typeof d === 'string' && d.trim())
  if (withDisagreements && points.length) parts.push('The top disagreements.', ...points.map(stop))
  return announce(`checkpoint-${cp.round}`, parts.join(' '), cp.round)
}

/**
 * The live queue: finished turns and checkpoints in arrival order, with a round title before each new round.
 * It stops at the first turn still streaming, so lines are only ever appended and the order never shifts.
 * Live checkpoints are brief (the summary); the full points stay on screen.
 */
export function liveScript(state: DebateState): Line[] {
  const lines: Line[] = []
  let round = 0
  for (const item of state.feed) {
    if (item.kind === 'failure') continue
    if (item.kind === 'checkpoint') { lines.push(checkpointLine(item, false)); continue }
    const t = state.turns[item.id]
    if (t.status !== 'done') break
    if (!t.text.trim()) continue
    if (t.round !== round) { lines.push(roundTitle(t.round)); round = t.round }
    lines.push(turnLine(t.id, t.agent, t.round, t.text))
  }
  return lines
}

function verdictLine(v: Verdict): Line {
  const parts = [
    'The verdict.',
    `${CALL[v.recommendation] ?? stop(String(v.recommendation))}.`,
    `Confidence ${Math.round(v.confidence * 100)} percent.`,
    stop(v.one_line_summary),
  ]
  const risks = [...(v.risks ?? [])].sort((a, b) => a.rank - b.rank).map((r) => stop(r.risk))
  if (risks.length) parts.push('The top risks.', ...risks)
  return announce('verdict', parts.join(' '))
}

/**
 * The whole debate as a broadcast: announcer intro with the pitch, every stored turn by row order,
 * the checkpoints in full, the founder's rebuttal where it happened (after round 1), then the verdict.
 */
export function replayScript(debate: DebateRecord): Line[] {
  const lines: Line[] = []
  if (debate.pitch?.trim()) lines.push(announce('intro', `Startup War Room. Tonight's pitch. ${stop(debate.pitch)}`))
  const turns = [...(debate.turns ?? [])].sort((a, b) => a.id - b.id)
  const rebuttal = typeof debate.rebuttal === 'string' && debate.rebuttal.trim() ? debate.rebuttal : null
  const founder: Line | null = rebuttal ? { key: 'rebuttal', voice: 'founder', who: 'Founder', round: 1, text: rebuttal } : null
  let placed = false
  let round = 0
  for (const t of turns) {
    if (!t.text?.trim()) continue
    if (founder && !placed && t.round >= 2) { lines.push(founder); placed = true }
    if (t.agent === 'moderator') {
      const d = (t.details as { top_disagreements?: [string, string] } | null)?.top_disagreements
      lines.push(checkpointLine({ round: t.round, summary: t.text, top_disagreements: d ?? ['', ''] }, true))
      continue
    }
    if (t.round !== round) { lines.push(roundTitle(t.round)); round = t.round }
    lines.push(turnLine(`turn-${t.id}`, t.agent, t.round, t.text))
  }
  if (founder && !placed) lines.push(founder)
  if (debate.verdict) lines.push(verdictLine(debate.verdict))
  return lines
}
