import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence } from 'motion/react'
import { m } from 'motion/react'
import type { AgentId, DebateState } from '../lib/debateReducer'
import AgentCard from './AgentCard'
import FighterGlyph from './FighterGlyph'
import ModeratorBanner from './ModeratorBanner'
import RebuttalBox from './RebuttalBox'
import RoundIndicator from './RoundIndicator'
import ThemeSwitcher from './ThemeSwitcher'
import Transcript from './Transcript'
import BellFlash from './motion/BellFlash'
import RoundTitle from './motion/RoundTitle'
import VersusIntro from './motion/VersusIntro'
import { useCalm } from './motion/useCalm'
import { useArenaCues } from './arenaCues'
import { AGENT_NAME, tonight } from './agentInfo'

const MAX_TURNS = 14
const LEFT: AgentId[] = ['vc', 'customer']
const RIGHT: AgentId[] = ['cto', 'competitor']
const FIGHTERS: AgentId[] = ['vc', 'customer', 'cto', 'competitor']
export const FINISHED = ['complete', 'budget_exceeded', 'partial']

interface Props {
  id: string
  state: DebateState
  /** The founder's pitch, when known, shown in the versus intro. */
  pitch?: string
  /** Set when the connection was lost for good. */
  lost: string | null
  /** Sends a rebuttal. Omit to use the real API. */
  sendRebuttal?: (text: string) => Promise<void>
}

/** Everything on screen in the debate room, as a function of the stream state. The connection lives in DebateRoom. */
export default function DebateView({ id, state, pitch, lost, sendRebuttal }: Props) {
  const calm = useCalm()
  const [dismissed, setDismissed] = useState<object | null>(null)
  const [lateNote, setLateNote] = useState<string | null>(null)
  const cues = useArenaCues(state, id, calm)

  const turns = useMemo(() => state.order.map((tid) => state.turns[tid]), [state.order, state.turns])
  const activeAgent = [...turns].reverse().find((t) => t.status === 'streaming')?.agent
  const round = Math.max(0, ...turns.map((t) => t.round), ...state.checkpoints.map((c) => c.round))
  const done = turns.filter((t) => t.status === 'done')
  const progress = Math.min(1, (done.length + state.checkpoints.length) / MAX_TURNS)
  const turnsByRound = [1, 2, 3].map((r) => done.filter((t) => t.round === r).map((t) => t.agent))
  const card = tonight(state.persona, state.competitors)

  const ended = state.status !== 'connecting' && state.status !== 'running'
  const stopped = lost !== null || state.error?.recoverable === false || (ended && !FINISHED.includes(state.status))
  const showRebuttal = state.awaitingRebuttal !== null && state.awaitingRebuttal !== dismissed && !stopped

  const seat = (agent: AgentId) => (
    <AgentCard
      key={agent}
      agent={agent}
      active={activeAgent === agent}
      turns={done.filter((t) => t.agent === agent).length}
      latest={[...turns].reverse().find((t) => t.agent === agent && t.finalPosition)}
      warming={state.order.length === 0 && !stopped}
      said={[...done].reverse().find((t) => t.agent === agent)?.text}
      tonight={agent === 'customer' ? card.customer : agent === 'competitor' ? card.rival : undefined}
    />
  )

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-3 px-4 py-3 lg:h-screen">
      <AnimatePresence>{cues.versus && <VersusIntro key="versus" pitch={pitch} tonight={card} />}</AnimatePresence>
      <AnimatePresence>{cues.titleRound !== null && <RoundTitle key={`round${cues.titleRound}`} round={cues.titleRound} calm={calm} />}</AnimatePresence>
      <AnimatePresence>{cues.bellFlash && <BellFlash key="bell" />}</AnimatePresence>

      <header className="space-y-2.5">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="display shrink-0 whitespace-nowrap text-[1.45rem] underline-offset-4 hover:underline sm:text-3xl">Startup War Room</Link>
          {pitch && (
            <p className="hidden min-w-0 flex-1 truncate font-body md:block" title={pitch}>
              <span className="mr-1.5 font-ui font-extrabold">In the ring:</span>{pitch}
            </p>
          )}
          <ThemeSwitcher />
        </div>
        <ModeratorBanner state={state} />
        <RoundIndicator
          round={round}
          progress={progress}
          turnsByRound={turnsByRound}
          checkpointRounds={state.checkpoints.map((c) => c.round)}
        />
      </header>

      {stopped && (
        <div role="alert" className="surface border-l-[10px] !border-l-competitor px-4 py-3">
          <p className="font-body">
            {lost ?? state.error?.message ?? 'This debate ended before it reached a verdict.'}
          </p>
          <Link to="/" className="mt-2 inline-block font-extrabold underline underline-offset-4">Start a new debate</Link>
        </div>
      )}

      {state.error?.recoverable === true && (
        <p role="status" className="rounded-md border-[3px] border-line bg-vc px-3 py-1.5 text-sm font-bold text-fill-ink">{state.error.message}</p>
      )}

      {/* On narrow screens the four seats are far below the feed, so this strip shows who has the floor. */}
      <ul aria-hidden="true" className="grid grid-cols-4 gap-2 lg:hidden">
        {FIGHTERS.map((a) => {
          const on = activeAgent === a
          return (
            <m.li
              key={a}
              data-agent={a}
              animate={calm ? undefined : { y: on ? -4 : 0, scale: on ? 1.06 : 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 18 }}
              className="surface flex flex-col items-center gap-0.5 px-1 py-1 text-fill-ink"
              style={{ background: on ? 'var(--agent)' : undefined, color: on ? undefined : 'var(--color-ink)', boxShadow: on ? '4px 4px 0 var(--color-shade)' : '2px 2px 0 var(--color-shade)' }}
            >
              <FighterGlyph agent={a} className="size-6" />
              <span className="text-[0.7rem] font-extrabold">{AGENT_NAME[a]}</span>
            </m.li>
          )
        })}
      </ul>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)_18rem]">
        <div className="order-2 grid min-w-0 grid-cols-1 gap-4 lg:order-1 lg:content-start lg:overflow-y-auto lg:p-3">{LEFT.map(seat)}</div>

        <div className="order-1 flex h-[62vh] min-h-0 min-w-0 flex-col lg:order-2 lg:h-auto">
          <Transcript state={state} pitch={pitch} />
          {lateNote && <p role="status" className="px-1 pt-2 text-sm font-semibold text-on-canvas">{lateNote}</p>}
          {showRebuttal && (
            <RebuttalBox
              key={state.checkpoints.length}
              debateId={id}
              timeoutS={state.awaitingRebuttal!.timeout_s}
              send={sendRebuttal}
              onClosed={(note) => { setDismissed(state.awaitingRebuttal); setLateNote(note ?? null) }}
            />
          )}
        </div>

        <div className="order-3 grid min-w-0 grid-cols-1 gap-4 lg:content-start lg:overflow-y-auto lg:p-3">{RIGHT.map(seat)}</div>
      </div>
    </main>
  )
}
