/**
 * `/?demo=1` (development only): plays dev/demoDebate.ts through the real reducer and the real screens.
 *   speed=2        play twice as fast
 *   kind=go        verdict variant: pivot (default), go, no_go, partial
 *   at=round2      jump ahead first: round2, checkpoint, rebuttal, final, verdict
 */
import { useEffect, useMemo, useReducer, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import DebateView from '../components/DebateView'
import { debateReducer, initialDebateState, type DebateAction } from '../lib/debateReducer'
import { VerdictBody } from '../pages/Verdict'
import type { StoredTurn } from '../lib/api'
import { DEMO_PITCH, demoScript, type DemoStep, type VerdictKind } from './demoDebate'

const JUMPS: Record<string, (s: DemoStep) => boolean> = {
  round2: (s) => s.action.type === 'turn_start' && s.action.data.round === 2,
  checkpoint: (s) => s.action.type === 'checkpoint',
  rebuttal: (s) => s.action.type === 'await_rebuttal',
  final: (s) => s.action.type === 'checkpoint' && s.action.data.round === 3,
  verdict: (s) => s.action.type === 'verdict',
}

export default function DemoRoom() {
  const [params] = useSearchParams()
  const speed = Math.max(0.25, Number(params.get('speed')) || 1)
  const kind = (params.get('kind') ?? 'pivot') as VerdictKind
  const at = params.get('at') ?? ''
  const [state, dispatch] = useReducer(debateReducer, initialDebateState)
  const release = useRef<((text: string | null) => void) | null>(null)
  const steps = useMemo(() => demoScript({ kind }), [kind])

  useEffect(() => {
    sessionStorage.removeItem('swr.versus.demo')
    const jump = JUMPS[at] ? steps.findIndex(JUMPS[at]) : -1
    const apply = (a: DebateAction) => dispatch(a)
    for (let i = 0; i <= jump; i++) apply(steps[i].action)

    let timer = 0
    let live = true
    const play = (i: number) => {
      if (!live || i >= steps.length) return
      const step = steps[i]
      const prev = i > 0 ? steps[i - 1].at : 0
      const go = () => { if (live) { apply(step.action); play(i + 1) } }
      if (step.action.type === 'rebuttal_received') {
        // Hold the room open until the viewer answers or the window runs out.
        const timeout = window.setTimeout(go, (step.at - prev) / speed)
        release.current = (text) => {
          clearTimeout(timeout)
          release.current = null
          if (live) { apply({ ...step.action, data: { text } } as DebateAction); play(i + 1) }
        }
        return
      }
      timer = window.setTimeout(go, Math.max(0, (step.at - prev) / speed))
    }
    play(jump + 1)
    return () => { live = false; clearTimeout(timer); release.current = null }
  }, [steps, speed, at])

  const finished = state.verdict !== null && (state.status === 'complete' || state.status === 'partial')
  // The same shape GET /debates/{id} returns, so the broadcast replay has stored turns to read.
  const turns = state.feed.flatMap((item, i): StoredTurn[] => {
    if (item.kind === 'checkpoint') return [{ id: i + 1, round: item.round, agent: 'moderator', text: item.summary, details: { top_disagreements: item.top_disagreements } }]
    if (item.kind !== 'turn') return []
    const t = state.turns[item.id]
    return t.text.trim() ? [{ id: i + 1, round: t.round, agent: t.agent, text: t.text }] : []
  })
  const record = { id: 'demo', pitch: DEMO_PITCH, status: state.status, verdict: state.verdict, rebuttal: state.rebuttal, turns }

  return (
    <>
      {finished && state.verdict
        ? <VerdictBody id="demo" debate={record} verdict={state.verdict} />
        : <DebateView
            id="demo"
            state={state}
            pitch={DEMO_PITCH}
            lost={null}
            sendRebuttal={(text) => { release.current?.(text || null); return Promise.resolve() }}
          />}
      <p data-print="hide" className="fixed bottom-2 left-2 z-[60] flex items-center gap-2 rounded-md border-2 border-line bg-panel px-2 py-1 text-xs font-bold text-ink">
        Demo
        <button type="button" className="underline" onClick={() => window.location.reload()}>restart</button>
      </p>
    </>
  )

}
