import { m } from 'motion/react'
import type { DebateState } from '../lib/debateReducer'
import Bell from './Bell'
import { useCalm } from './motion/useCalm'

/** The referee's current line: the latest checkpoint, else the latest setup step. */
export default function ModeratorBanner({ state }: { state: DebateState }) {
  const calm = useCalm()
  const cp = state.checkpoints.at(-1)
  const setup = state.setup.at(-1)
  if (!cp && !setup) return null
  return (
    <aside data-agent="moderator" aria-label="Moderator" className="surface flex overflow-hidden">
      <div className="grid w-14 shrink-0 place-items-center border-r-[3px] border-line bg-(--agent) text-fill-ink sm:w-20">
        <Bell ringing={false} className="size-8 sm:size-10" />
      </div>
      <m.div
        key={cp ? `cp${state.checkpoints.length}` : `s${state.setup.length}`}
        className="min-w-0 px-4 py-2.5"
        initial={calm ? false : { opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <p className="text-sm font-extrabold text-(--agent-ink)">Moderator</p>
        {cp ? (
          <>
            <p className="mt-0.5 font-body leading-snug">{cp.summary}</p>
            <ul className="mt-1.5 space-y-0.5 text-sm text-muted">
              {cp.top_disagreements.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </>
        ) : (
          <p className="mt-0.5 font-body leading-snug">{setup!.message}</p>
        )}
      </m.div>
    </aside>
  )
}
