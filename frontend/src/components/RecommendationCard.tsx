import { m } from 'motion/react'
import type { Verdict } from '../lib/debateReducer'
import { useCalm } from './motion/useCalm'
import { useReveal } from './motion/reveal'

const CALL: Record<Verdict['recommendation'], { label: string; fill: string }> = {
  go: { label: 'Go', fill: 'var(--color-customer)' },
  pivot: { label: 'Pivot', fill: 'var(--color-vc)' },
  no_go: { label: 'No-go', fill: 'var(--color-competitor)' },
}
const CONFETTI = ['--color-vc', '--color-customer', '--color-cto', '--color-competitor', '--color-moderator']

/** The moderator's call, stamped onto the page. A go also throws confetti. */
export default function RecommendationCard({ verdict }: { verdict: Verdict }) {
  const calm = useCalm()
  const { stamp } = useReveal()
  const call = CALL[verdict.recommendation] ?? CALL.pivot
  const pct = Math.round(verdict.confidence * 100)
  const landed = calm || stamp
  return (
    <section aria-labelledby="rec" className="surface relative p-5 sm:p-7">
      <p className="text-sm font-bold text-muted">The moderator's call</p>
      <div className="relative mt-3 min-h-[8.5rem] sm:min-h-[11rem]">
        <m.div
          className="stamp relative inline-block -rotate-3 rounded-lg border-[6px] border-line px-5 py-1 text-fill-ink sm:px-8"
          style={{ background: call.fill, boxShadow: '8px 8px 0 var(--color-shade)', outline: '3px solid var(--color-line)', outlineOffset: '-14px', transformOrigin: '30% 60%' }}
          initial={calm ? false : { scale: 3.4, rotate: 14, opacity: 0 }}
          animate={landed ? { scale: 1, rotate: -3, opacity: 1 } : { scale: 3.4, rotate: 14, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 700, damping: 17, mass: 0.9 }}
        >
          <h1 id="rec" className="display text-[clamp(4.5rem,15vw,9rem)] leading-[0.95]">{call.label}</h1>
        </m.div>
        {landed && !calm && (
          <>
            {/* Impact ring and a screen-shake feel on the card itself. */}
            <m.span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 h-full w-[min(100%,26rem)] rounded-lg border-[6px] border-line"
              initial={{ scale: 1, opacity: 0.8 }}
              animate={{ scale: 1.35, opacity: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
            {verdict.recommendation === 'go' && CONFETTI.flatMap((c, k) => [0, 1, 2].map((j) => {
              const n = k * 3 + j
              const ang = (n / 15) * Math.PI * 2
              return (
                <m.span
                  key={n}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-[30%] top-1/2 block h-3 w-2 rounded-[1px]"
                  style={{ background: `var(${c})`, border: '1.5px solid var(--color-line)' }}
                  initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
                  animate={{ x: Math.cos(ang) * (120 + (n % 4) * 40), y: Math.sin(ang) * (90 + (n % 3) * 30) + 60, opacity: 0, rotate: 360 + n * 40 }}
                  transition={{ duration: 1.3 + (n % 5) * 0.12, ease: 'easeOut' }}
                />
              )
            }))}
          </>
        )}
      </div>
      <p className="mt-5 max-w-xl font-body text-xl leading-relaxed">{verdict.one_line_summary}</p>
      <div className="mt-5 flex max-w-sm items-center gap-3 text-sm font-bold">
        <div
          className="h-4 flex-1 overflow-hidden rounded-full border-[3px] border-line bg-panel-hi"
          role="meter"
          aria-label="Confidence"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <m.div
            className="h-full origin-left"
            style={{ background: call.fill }}
            initial={calm ? false : { scaleX: 0 }}
            animate={{ scaleX: landed ? pct / 100 : 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          />
        </div>
        <span>{pct}% confident</span>
      </div>
    </section>
  )
}
