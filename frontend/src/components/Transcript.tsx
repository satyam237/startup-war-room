import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import type { AgentId, DebateState, SetupStep } from '../lib/debateReducer'
import { AGENT_NAME, tonight } from './agentInfo'
import Bell from './Bell'
import FighterGlyph from './FighterGlyph'
import { useCalm } from './motion/useCalm'

const NEAR_BOTTOM = 48
const LEFT_CORNER: AgentId[] = ['vc', 'customer']

/** Seconds since this component mounted: the honest length of the wait. */
function useElapsed(): number {
  const [s, setS] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setS((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return s
}

const STATIONS: { step: SetupStep; planned: string }[] = [
  { step: 'persona', planned: 'Build the customer persona' },
  { step: 'competitors', planned: 'Find the rivals' },
  { step: 'ready', planned: 'Seat the panel' },
]
const SLOW_AFTER_S = 40

/** The wait before the first argument. Each station lights only when its real setup event arrives. */
function SetupStage({ state, pitch }: { state: DebateState; pitch?: string }) {
  const elapsed = useElapsed()
  const { setup } = state
  const latest = Math.max(...setup.map((s) => STATIONS.findIndex((st) => st.step === s.step)), -1)
  const ready = setup.some((s) => s.step === 'ready')
  const card = tonight(state.persona, state.competitors)
  return (
    <div data-testid="setup-stage" data-agent="moderator" className="surface overflow-hidden">
      <div className="ref-stripes h-3 border-b-[3px] border-line" aria-hidden="true" />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="display text-4xl">{setup.length === 0 ? 'Connecting to the room' : 'Getting the ring ready'}</p>
          <span className="shrink-0 text-sm font-bold text-muted">{elapsed}s in</span>
        </div>
        {pitch && (
          <p className="line-clamp-3 border-l-[6px] border-(--agent) pl-3 font-body leading-snug">
            <span className="mr-1.5 font-ui font-extrabold">In the ring:</span>{pitch}
          </p>
        )}
        <ol className="space-y-2.5 font-body">
          {STATIONS.map((st, i) => {
            const events = setup.filter((s) => s.step === st.step)
            const isDone = ready || i < latest
            const isActive = !ready && i === latest
            const fact = st.step === 'persona' ? card.customer : st.step === 'competitors' ? card.rival : undefined
            return (
              <li key={st.step} data-step-state={isDone ? 'done' : isActive ? 'active' : 'pending'} className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className={`mt-1 size-4 shrink-0 rounded-full border-[3px] border-line ${isDone ? 'bg-customer' : isActive ? 'bg-(--agent)' : 'bg-panel-hi'}`}
                />
                <span className={isActive ? 'font-semibold' : isDone ? '' : 'text-muted'}>
                  {events.at(-1)?.message ?? st.planned}
                  {fact && <span className="block font-ui text-sm font-bold text-muted">{fact}</span>}
                </span>
              </li>
            )
          })}
          {ready && (
            <li data-step-state="active" className="flex items-start gap-2.5">
              <span aria-hidden="true" className="mt-1 size-4 shrink-0 rounded-full border-[3px] border-line bg-(--agent)" />
              <span className="font-semibold">Waiting for the first argument</span>
            </li>
          )}
        </ol>
        <div className="relative h-3 overflow-hidden rounded-sm border-[3px] border-line bg-panel-hi" aria-hidden="true">
          <div className="sweep absolute inset-y-0 left-0 w-1/3 bg-(--agent)" />
        </div>
        <p className="text-sm text-muted">
          {elapsed < SLOW_AFTER_S
            ? 'The first argument usually lands about 15 seconds after you start.'
            : 'This is taking longer than usual. The room is still working on it.'}
        </p>
      </div>
    </div>
  )
}

/** Central feed. Follows new text until the reader scrolls up, then offers a way back. */
export default function Transcript({ state, pitch }: { state: DebateState; pitch?: string }) {
  const calm = useCalm()
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [away, setAway] = useState(false)
  // Rows that were already there when this mounted (a reload mid-debate) appear without the landing animation.
  const restored = useRef(state.feed.length)

  const size = state.order.reduce((n, id) => n + state.turns[id].text.length, 0)
    + state.setup.length + state.failures.length + state.checkpoints.length

  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [size])

  function onScroll() {
    const el = ref.current!
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
    pinned.current = near
    setAway(!near)
  }

  function jump() {
    const el = ref.current!
    el.scrollTop = el.scrollHeight
    pinned.current = true
    setAway(false)
  }

  const waiting = state.order.length === 0
  const lastCheckpoint = state.checkpoints.length
  let cpSeen = 0

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={onScroll}
        role="log"
        aria-label="Debate transcript"
        className="h-full space-y-4 overflow-x-hidden overflow-y-auto px-1 py-2 pb-4 pr-2"
      >
        {waiting
          ? <SetupStage state={state} pitch={pitch} />
          : null}
        {state.feed.map((item, i) => {
          const fresh = i >= restored.current && !calm
          const land = (fromX: number) => ({
            initial: fresh ? { opacity: 0, x: fromX, y: 14, scale: 0.94, rotate: fromX < 0 ? -2 : fromX > 0 ? 2 : 0 } : false,
            animate: { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 },
            transition: { type: 'spring' as const, stiffness: 520, damping: 22 },
          })
          if (item.kind === 'failure') {
            return (
              <m.p key={i} data-agent={item.agent} {...land(0)} className="rounded border-[3px] border-dashed border-line bg-panel-hi px-4 py-2 text-sm font-semibold text-ink">
                {item.note}
              </m.p>
            )
          }
          if (item.kind === 'checkpoint') {
            cpSeen += 1
            const newest = cpSeen === lastCheckpoint
            return (
              <m.div key={i} data-agent="moderator" {...land(0)} className="surface flex overflow-hidden !bg-panel-hi">
                <div className="ref-stripes grid w-12 shrink-0 place-items-center border-r-[3px] border-line text-fill-ink sm:w-16">
                  <span className="grid size-9 place-items-center rounded-full border-[3px] border-line bg-(--agent)">
                    <Bell ringing={newest && fresh} className="size-6" />
                  </span>
                </div>
                <div className="min-w-0 px-3 py-2.5 sm:px-4">
                  <p className="display text-2xl text-(--agent-ink)">End of round {item.round}</p>
                  <p className="mt-1 font-body leading-relaxed">{item.summary}</p>
                  <ul className="mt-1.5 list-disc pl-5 text-sm text-muted">
                    {item.top_disagreements.map((d, j) => <li key={j}>{d}</li>)}
                  </ul>
                </div>
              </m.div>
            )
          }
          const t = state.turns[item.id]
          // A turn reset and then failed ends with no text; its failure note says why.
          if (t.status === 'done' && !t.text.trim()) return null
          const left = LEFT_CORNER.includes(t.agent)
          return (
            <m.article
              key={i}
              data-agent={t.agent}
              data-corner={left ? 'left' : 'right'}
              {...land(left ? -110 : 110)}
              className={`surface relative ${left ? 'mr-5 sm:mr-14' : 'ml-5 sm:ml-14'}`}
            >
              {fresh && (
                <m.span
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-0.5 rounded border-[4px] border-(--agent)"
                  initial={{ scale: 1, opacity: 0.9 }}
                  animate={{ scale: 1.06, opacity: 0 }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                />
              )}
              <h3 className={`display flex items-center gap-2 bg-(--agent) px-3 py-1 text-2xl text-fill-ink ${left ? '' : 'flex-row-reverse'}`}>
                <FighterGlyph agent={t.agent} className="size-6 shrink-0" />
                {AGENT_NAME[t.agent]}
                <span className={`font-ui text-sm font-bold normal-case tracking-normal ${left ? 'ml-auto' : 'mr-auto'}`}>Round {t.round}</span>
              </h3>
              <p className="whitespace-pre-wrap border-t-[3px] border-line px-3.5 py-2.5 font-body leading-relaxed sm:px-4">
                {t.text}
                {t.status === 'streaming' && <span className="caret" aria-hidden="true" />}
              </p>
            </m.article>
          )
        })}
      </div>
      {away && (
        <button type="button" onClick={jump} className="slab absolute bottom-3 left-1/2 -translate-x-1/2 bg-accent px-4 py-1.5 text-sm text-on-accent">
          Jump to latest
        </button>
      )}
    </div>
  )
}
