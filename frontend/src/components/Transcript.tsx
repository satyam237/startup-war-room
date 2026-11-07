import { useEffect, useRef, useState } from 'react'
import type { DebateState } from '../lib/debateReducer'
import { AGENT_NAME } from './AgentCard'

const NEAR_BOTTOM = 48

/** Central feed. Follows new text until the reader scrolls up, then offers a way back. */
export default function Transcript({ state }: { state: DebateState }) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [away, setAway] = useState(false)

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

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={onScroll}
        role="log"
        aria-label="Debate transcript"
        className="h-full space-y-4 overflow-y-auto px-1 py-2"
      >
        {state.setup.map((s, i) => (
          <p key={i} className="font-body italic text-muted">{s.message}</p>
        ))}
        {state.feed.map((item, i) => {
          if (item.kind === 'failure') {
            return (
              <p key={i} data-agent={item.agent} className="border-l-4 border-dashed border-(--agent) pl-4 text-sm text-muted">
                {item.note}
              </p>
            )
          }
          if (item.kind === 'checkpoint') {
            return (
              <div key={i} data-agent="moderator" className="border-y border-line py-3">
                <p className="font-display text-sm font-bold text-(--agent)">Moderator, end of round {item.round}</p>
                <p className="mt-1 font-body leading-relaxed">{item.summary}</p>
                <ul className="mt-2 list-disc pl-5 text-sm text-muted">
                  {item.top_disagreements.map((d, j) => <li key={j}>{d}</li>)}
                </ul>
              </div>
            )
          }
          const t = state.turns[item.id]
          // A turn reset and then failed ends with no text; its failure note says why.
          if (t.status === 'done' && !t.text.trim()) return null
          return (
            <article key={i} data-agent={t.agent} className="border-l-4 border-(--agent) pl-4">
              <h3 className="font-display text-sm font-bold text-(--agent)">
                {AGENT_NAME[t.agent]}
                <span className="ml-2 font-normal text-muted">Round {t.round}</span>
              </h3>
              <p className="mt-1 whitespace-pre-wrap font-body leading-relaxed">
                {t.text}
                {t.status === 'streaming' && <span className="caret" aria-hidden="true" />}
              </p>
            </article>
          )
        })}
      </div>
      {away && (
        <button
          type="button"
          onClick={jump}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-sm font-bold text-bunker shadow-lg"
        >
          Jump to latest
        </button>
      )}
    </div>
  )
}
