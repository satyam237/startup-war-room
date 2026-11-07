import { m } from 'motion/react'
import type { AgentId } from '../../lib/debateReducer'
import { AGENT_NAME } from '../agentInfo'
import FighterGlyph from '../FighterGlyph'

const BANDS: AgentId[] = ['vc', 'customer', 'cto', 'competitor']
export const VERSUS_MS = 2600

/** Full-screen fight-card intro: four colour bands slam in, VS lands, then it all wipes away. Decorative. */
export default function VersusIntro({ pitch }: { pitch?: string }) {
  return (
    <div data-testid="versus" aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 flex flex-col overflow-hidden">
      {BANDS.map((a, i) => {
        const fromLeft = i % 2 === 0
        return (
          <m.div
            key={a}
            data-agent={a}
            className={`flex flex-1 items-center gap-4 border-y-[3px] border-line bg-(--agent) px-[6vw] text-fill-ink ${fromLeft ? 'justify-start' : 'flex-row-reverse justify-start'}`}
            initial={{ x: fromLeft ? '-105%' : '105%' }}
            animate={{ x: 0 }}
            exit={{ x: fromLeft ? '105%' : '-105%', transition: { duration: 0.45, delay: i * 0.05, ease: [0.7, 0, 0.84, 0] } }}
            transition={{ type: 'spring', stiffness: 220, damping: 24, delay: 0.08 * i }}
          >
            <FighterGlyph agent={a} className="size-[clamp(2.5rem,9vh,5.5rem)] shrink-0" />
            <span className="display text-[clamp(2.6rem,13vh,8rem)]">{AGENT_NAME[a]}</span>
          </m.div>
        )
      })}
      <m.div
        className="absolute left-1/2 top-1/2 grid size-[clamp(7rem,22vh,12rem)] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[5px] border-line bg-panel text-ink"
        style={{ boxShadow: '8px 8px 0 var(--color-shade)' }}
        initial={{ scale: 4, rotate: -25, opacity: 0 }}
        animate={{ scale: 1, rotate: -6, opacity: 1 }}
        exit={{ scale: 0, opacity: 0, transition: { duration: 0.25 } }}
        transition={{ type: 'spring', stiffness: 520, damping: 16, delay: 0.65 }}
      >
        <span className="display text-[clamp(3rem,12vh,6.5rem)]">VS</span>
      </m.div>
      {pitch && (
        <m.p
          className="absolute inset-x-0 bottom-[5vh] mx-auto w-[min(92vw,44rem)] rounded-md border-[3px] border-line bg-panel px-4 py-2 text-center font-body text-sm text-ink sm:text-base"
          style={{ boxShadow: '4px 4px 0 var(--color-shade)' }}
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={{ delay: 1.1 }}
        >
          In the ring: {pitch.length > 120 ? `${pitch.slice(0, 117)}...` : pitch}
        </m.p>
      )}
    </div>
  )
}
