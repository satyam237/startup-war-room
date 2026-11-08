import { m } from 'motion/react'
import type { AgentId } from '../../lib/debateReducer'
import { AGENT_NAME, ROLE } from '../agentInfo'
import FighterGlyph from '../FighterGlyph'

const BANDS: AgentId[] = ['vc', 'customer', 'cto', 'competitor']
const EXCERPT = 150
export const VERSUS_MS = 2900

function excerpt(pitch: string): string {
  if (pitch.length <= EXCERPT) return pitch
  return `${pitch.slice(0, EXCERPT).replace(/\s+\S*$/, '')}...`
}

interface Props {
  pitch?: string
  /** Who the customer and rival turned out to be tonight. */
  tonight: { customer?: string; rival?: string }
}

/** The fight card: the founder's idea slides in from one side, the four challengers from the other, and VS lands on the seam. Decorative. */
export default function VersusIntro({ pitch, tonight }: Props) {
  const sub: Partial<Record<AgentId, string>> = { customer: tonight.customer, competitor: tonight.rival }
  return (
    <div data-testid="versus" aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 flex flex-col overflow-hidden md:flex-row">
      <m.div
        className="relative flex h-[36%] flex-col justify-center gap-3 border-b-[5px] border-line bg-accent px-[6vw] text-on-accent md:h-auto md:w-[42%] md:border-b-0 md:border-r-[5px]"
        initial={{ x: '-105%' }}
        animate={{ x: 0 }}
        exit={{ x: '-105%', transition: { duration: 0.4, delay: 0.1, ease: [0.7, 0, 0.84, 0] } }}
        transition={{ type: 'spring', stiffness: 240, damping: 26 }}
      >
        <p className="display text-[clamp(3rem,min(11vh,15vw),8rem)]">Your idea</p>
        {pitch && <p className="max-w-md pr-[20vw] font-body text-sm leading-snug sm:text-lg md:pr-0">{excerpt(pitch)}</p>}
      </m.div>
      <div className="flex min-h-0 flex-1 flex-col">
        {BANDS.map((a, i) => (
          <m.div
            key={a}
            data-agent={a}
            className="flex min-h-0 flex-1 items-center gap-4 border-b-[3px] border-line bg-(--agent) pl-[6vw] pr-5 md:pl-[clamp(3.5rem,9vw,8rem)] text-fill-ink last:border-b-0"
            initial={{ x: '105%' }}
            animate={{ x: 0 }}
            exit={{ x: '105%', transition: { duration: 0.4, delay: i * 0.04, ease: [0.7, 0, 0.84, 0] } }}
            transition={{ type: 'spring', stiffness: 240, damping: 24, delay: 0.1 + 0.08 * i }}
          >
            <FighterGlyph agent={a} className="size-[clamp(2.4rem,9vh,5rem)] shrink-0" />
            <div className="min-w-0">
              <p className="display text-[clamp(2.2rem,min(9.5vh,13vw),5.5rem)]">{AGENT_NAME[a]}</p>
              <p className="truncate text-sm font-bold sm:text-base">{sub[a] ?? ROLE[a]}</p>
            </div>
          </m.div>
        ))}
      </div>
      <m.div
        className="absolute right-[5vw] top-[36%] grid size-[clamp(5.5rem,min(20vh,26vw),10.5rem)] -translate-y-1/2 place-items-center rounded-full border-[5px] border-line bg-panel text-ink md:left-[42%] md:right-auto md:top-1/2 md:-translate-x-1/2"
        style={{ boxShadow: '8px 8px 0 var(--color-punch)' }}
        initial={{ scale: 4, rotate: -25, opacity: 0 }}
        animate={{ scale: 1, rotate: -6, opacity: 1 }}
        exit={{ scale: 0, opacity: 0, transition: { duration: 0.2 } }}
        transition={{ type: 'spring', stiffness: 520, damping: 16, delay: 0.7 }}
      >
        <span className="display text-[clamp(2.6rem,min(10vh,13vw),5.5rem)]">VS</span>
      </m.div>
    </div>
  )
}
