import { m } from 'motion/react'
import type { DebateState } from '../lib/debateReducer'
import Bell from './Bell'
import { useCalm } from './motion/useCalm'

/** The referee's current line: the latest checkpoint, else the latest setup step. The feed holds the full checkpoint. */
export default function ModeratorBanner({ state }: { state: DebateState }) {
  const calm = useCalm()
  const cp = state.checkpoints.at(-1)
  const setup = state.setup.at(-1)
  if (!cp && (!setup || state.order.length === 0)) return null
  return (
    <aside data-agent="moderator" aria-label="Moderator" className="surface flex items-stretch overflow-hidden">
      <div className="ref-stripes grid w-12 shrink-0 place-items-center border-r-[3px] border-line text-fill-ink sm:w-16">
        <span className="grid size-8 place-items-center rounded-full border-[3px] border-line bg-(--agent)"><Bell className="size-5" /></span>
      </div>
      <m.div
        key={cp ? `cp${state.checkpoints.length}` : `s${state.setup.length}`}
        className="min-w-0 px-3 py-1.5"
        initial={calm ? false : { opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <p className="line-clamp-2 font-body text-sm leading-snug sm:text-base">
          <span className="mr-2 font-ui text-sm font-extrabold text-(--agent-ink)">Moderator</span>
          {cp ? cp.summary : setup!.message}
        </p>
      </m.div>
    </aside>
  )
}
