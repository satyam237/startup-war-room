import { m } from 'motion/react'
import { AGENTS, type AgentId } from '../lib/debateReducer'
import { AGENT_NAME, ROLE } from './agentInfo'
import FighterGlyph from './FighterGlyph'
import { useCalm } from './motion/useCalm'
import { stage } from './motion/timing'

type Mood = 'idle' | 'ready' | 'locked'

/** The five who will be in the room, as fighter cards. Reacts to hover, and to the start button via `mood`. */
export default function Roster({ mood = 'idle' }: { mood?: Mood }) {
  const calm = useCalm()
  return (
    <ul aria-label="Who is in the room" className="relative -mx-5 -mt-5 flex snap-x scroll-pl-5 gap-3 overflow-x-auto px-5 pb-3 pt-3 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0">
      {AGENTS.map((a: AgentId, i) => (
        <m.li
          key={a}
          data-agent={a}
          data-mood={mood}
          className="w-[8.5rem] shrink-0 snap-start sm:w-auto"
          initial={calm ? false : { y: 70, opacity: 0, rotate: i % 2 ? 4 : -4 }}
          animate={{
            y: mood === 'locked' ? -10 : mood === 'ready' ? -6 : 0,
            opacity: 1,
            rotate: 0,
            scale: mood === 'locked' ? 1.03 : 1,
          }}
          transition={{ type: 'spring', stiffness: 380, damping: 18, delay: mood === 'idle' ? stage(0.55, i, calm, 0.09) : stage(0, i, calm, 0.04) }}
          whileHover={calm ? undefined : { y: -12, rotate: i % 2 ? 2.5 : -2.5, transition: { type: 'spring', stiffness: 500, damping: 14 } }}
          whileTap={calm ? undefined : { scale: 0.96 }}
        >
          <div className="surface group h-full overflow-hidden transition-shadow duration-150 hover:shadow-[8px_8px_0_var(--color-shade)]">
            <div className={`grid h-16 place-items-center text-fill-ink ${a === 'moderator' ? 'ref-stripes' : 'bg-(--agent)'}`}>
              <m.span
                className={`block ${a === 'moderator' ? 'grid size-13 place-items-center rounded-full border-[3px] border-line bg-(--agent)' : ''}`}
                whileHover={calm ? undefined : { scale: 1.25, rotate: [0, -12, 10, -6, 0], transition: { duration: 0.5 } }}
              >
                <FighterGlyph agent={a} className={a === 'moderator' ? 'size-8' : 'size-11'} />
              </m.span>
            </div>
            <div className="border-t-[3px] border-line px-2 py-1.5">
              <p className="display text-[1.32rem] text-(--agent-ink)">{AGENT_NAME[a]}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted sm:min-h-[3rem]">{ROLE[a]}</p>
            </div>
          </div>
        </m.li>
      ))}
    </ul>
  )
}
