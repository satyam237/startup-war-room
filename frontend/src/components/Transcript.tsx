import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import type { DebateState } from '../lib/debateReducer'
import { AGENT_NAME } from './agentInfo'
import Bell from './Bell'
import FighterGlyph from './FighterGlyph'
import { useCalm } from './motion/useCalm'

const NEAR_BOTTOM = 48

/** Seconds since this component mounted: the honest length of the wait. */
function useElapsed(): number {
  const [s, setS] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setS((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return s
}

/** The wait before the first argument, told with the real setup events as they arrive. */
function SetupStage({ state }: { state: DebateState }) {
  const elapsed = useElapsed()
  const { setup } = state
  const ready = setup.some((s) => s.step === 'ready')
  return (
    <div data-testid="setup-stage" data-agent="moderator" className="surface space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="display text-2xl">{setup.length === 0 ? 'Connecting to the room' : 'Getting the ring ready'}</p>
        <span className="text-sm font-bold text-muted">{elapsed}s in</span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full border-[3px] border-line bg-panel-hi" aria-hidden="true">
        <div className="sweep absolute inset-y-0 left-0 w-1/3 bg-(--agent)" />
      </div>
      <ol className="space-y-1.5 font-body">
        {setup.map((s, i) => {
          const isDone = i < setup.length - 1 || s.step === 'ready'
          return (
            <li key={i} data-step-state={isDone ? 'done' : 'active'} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className={`mt-1.5 size-3.5 shrink-0 rounded-full border-[3px] border-line ${isDone ? 'bg-customer' : 'bg-(--agent) pulse-ring'}`}
              />
              <span className={isDone ? 'text-muted' : 'font-semibold'}>{s.message}</span>
            </li>
          )
        })}
        {ready && (
          <li data-step-state="active" className="flex items-start gap-2.5">
            <span aria-hidden="true" className="pulse-ring mt-1.5 size-3.5 shrink-0 rounded-full border-[3px] border-line bg-(--agent)" />
            <span className="font-semibold">Waiting for the first argument</span>
          </li>
        )}
      </ol>
      <p className="text-sm text-muted">The first argument usually lands about 15 seconds after you start.</p>
    </div>
  )
}

/** Central feed. Follows new text until the reader scrolls up, then offers a way back. */
export default function Transcript({ state }: { state: DebateState }) {
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
        className="h-full space-y-4 overflow-y-auto px-1 py-2 pb-4 pr-2"
      >
        {waiting
          ? <SetupStage state={state} />
          : state.setup.map((s, i) => (
            <p key={i} className="font-body text-sm italic text-on-canvas-muted">{s.message}</p>
          ))}
        {state.feed.map((item, i) => {
          const fresh = i >= restored.current && !calm
          const land = {
            initial: fresh ? { opacity: 0, y: 36, scale: 0.93, rotate: i % 2 ? 1.2 : -1.2 } : false,
            animate: { opacity: 1, y: 0, scale: 1, rotate: 0 },
            transition: { type: 'spring' as const, stiffness: 520, damping: 22 },
          }
          if (item.kind === 'failure') {
            return (
              <m.p key={i} data-agent={item.agent} {...land} className="rounded-md border-[3px] border-dashed border-line bg-panel-hi px-4 py-2 text-sm font-semibold text-ink">
                {item.note}
              </m.p>
            )
          }
          if (item.kind === 'checkpoint') {
            cpSeen += 1
            const newest = cpSeen === lastCheckpoint
            return (
              <m.div key={i} data-agent="moderator" {...land} className="surface flex gap-3 overflow-hidden !bg-panel-hi">
                <div className="grid w-14 shrink-0 place-items-center border-r-[3px] border-line bg-(--agent) text-fill-ink">
                  <Bell ringing={newest && fresh} className="size-8" />
                </div>
                <div className="py-3 pr-4">
                  <p className="display text-xl text-(--agent-ink)">Moderator, end of round {item.round}</p>
                  <p className="mt-1 font-body leading-relaxed">{item.summary}</p>
                  <ul className="mt-2 list-disc pl-5 text-sm text-muted">
                    {item.top_disagreements.map((d, j) => <li key={j}>{d}</li>)}
                  </ul>
                </div>
              </m.div>
            )
          }
          const t = state.turns[item.id]
          // A turn reset and then failed ends with no text; its failure note says why.
          if (t.status === 'done' && !t.text.trim()) return null
          return (
            <m.article key={i} data-agent={t.agent} {...land} className="surface relative p-4">
              {fresh && (
                <m.span
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-0.5 rounded-[12px] border-[4px] border-(--agent)"
                  initial={{ scale: 1, opacity: 0.9 }}
                  animate={{ scale: 1.07, opacity: 0 }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                />
              )}
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-md border-[3px] border-line bg-(--agent) text-fill-ink">
                  <FighterGlyph agent={t.agent} className="size-7" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="display flex flex-wrap items-baseline gap-x-2 text-2xl text-(--agent-ink)">
                    {AGENT_NAME[t.agent]}
                    <span className="font-ui text-sm font-bold normal-case tracking-normal text-muted">Round {t.round}</span>
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap font-body leading-relaxed">
                    {t.text}
                    {t.status === 'streaming' && <span className="caret" aria-hidden="true" />}
                  </p>
                </div>
              </div>
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
