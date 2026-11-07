import { useEffect, useMemo, useReducer, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getDebate } from '../lib/api'
import { connectDebate } from '../lib/sse'
import { debateReducer, initialDebateState, type AgentId } from '../lib/debateReducer'
import AgentCard from '../components/AgentCard'
import ModeratorBanner from '../components/ModeratorBanner'
import RebuttalBox from '../components/RebuttalBox'
import RoundIndicator from '../components/RoundIndicator'
import Transcript from '../components/Transcript'

const MAX_TURNS = 14
const FINISHED = ['complete', 'budget_exceeded', 'partial']
const LEFT: AgentId[] = ['vc', 'customer']
const RIGHT: AgentId[] = ['cto', 'competitor']
const LOST_MESSAGE = 'The connection to this debate was lost, and it did not finish. Start a new debate to try again.'

export default function DebateRoom() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(debateReducer, initialDebateState)
  const [dismissed, setDismissed] = useState<object | null>(null)
  const [lateNote, setLateNote] = useState<string | null>(null)
  const [lost, setLost] = useState<string | null>(null)

  // An already-finished debate has nothing to watch: go straight to the verdict.
  useEffect(() => {
    let live = true
    getDebate(id)
      .then((d) => {
        if (live && (d.verdict || FINISHED.includes(String(d.status)))) navigate(`/d/${id}/verdict`, { replace: true })
      })
      .catch(() => { /* the stream below reports problems */ })
    return () => { live = false }
  }, [id, navigate])

  // The browser gave up on the stream (e.g. a 503 while the server restarts). Ask the server what
  // became of the debate: a finished one goes to its verdict, anything else is a dead end.
  useEffect(() => {
    let live = true
    const lose = () => { if (live) setLost(LOST_MESSAGE) }
    const close = connectDebate(id, dispatch, () => {
      getDebate(id)
        .then((d) => {
          if (!live) return
          if (d.verdict || FINISHED.includes(String(d.status))) navigate(`/d/${id}/verdict`, { replace: true })
          else lose()
        })
        .catch(lose)
    })
    return () => { live = false; close() }
  }, [id, navigate])

  useEffect(() => {
    if (FINISHED.includes(state.status)) navigate(`/d/${id}/verdict`, { replace: true })
  }, [state.status, id, navigate])

  const turns = useMemo(() => state.order.map((tid) => state.turns[tid]), [state.order, state.turns])
  const activeAgent = [...turns].reverse().find((t) => t.status === 'streaming')?.agent
  const round = Math.max(0, ...turns.map((t) => t.round), ...state.checkpoints.map((c) => c.round))
  const progress = Math.min(1, (turns.filter((t) => t.status === 'done').length + state.checkpoints.length) / MAX_TURNS)

  const ended = state.status !== 'connecting' && state.status !== 'running'
  const stopped = lost !== null || state.error?.recoverable === false || (ended && !FINISHED.includes(state.status))
  const showRebuttal = state.awaitingRebuttal !== null && state.awaitingRebuttal !== dismissed && !stopped

  const seat = (agent: AgentId) => (
    <AgentCard
      key={agent}
      agent={agent}
      active={activeAgent === agent}
      turns={turns.filter((t) => t.agent === agent && t.status === 'done').length}
      latest={[...turns].reverse().find((t) => t.agent === agent && t.finalPosition)}
    />
  )

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-5 lg:h-screen">
      <header className="space-y-3">
        <ModeratorBanner state={state} />
        <RoundIndicator round={round} progress={progress} />
      </header>

      {stopped && (
        <div role="alert" className="border-l-4 border-competitor bg-panel px-4 py-3">
          <p className="font-body">
            {lost ?? state.error?.message ?? 'This debate ended before it reached a verdict.'}
          </p>
          <Link to="/" className="mt-2 inline-block font-bold underline underline-offset-4">Start a new debate</Link>
        </div>
      )}

      {state.error?.recoverable === true && (
        <p role="status" className="text-sm text-muted">{state.error.message}</p>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[17rem_1fr_17rem]">
        <div className="order-2 grid gap-3 lg:order-1 lg:content-start">{LEFT.map(seat)}</div>

        <div className="order-1 flex h-[60vh] min-h-0 flex-col lg:order-2 lg:h-auto">
          <Transcript state={state} />
          {lateNote && <p role="status" className="px-1 pt-2 text-sm text-muted">{lateNote}</p>}
          {showRebuttal && (
            <RebuttalBox
              key={state.checkpoints.length}
              debateId={id}
              timeoutS={state.awaitingRebuttal!.timeout_s}
              onClosed={(note) => { setDismissed(state.awaitingRebuttal); setLateNote(note ?? null) }}
            />
          )}
        </div>

        <div className="order-3 grid gap-3 lg:content-start">{RIGHT.map(seat)}</div>
      </div>
    </main>
  )
}
