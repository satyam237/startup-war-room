import { m } from 'motion/react'
import type { Verdict } from '../lib/debateReducer'
import { useCalm } from './motion/useCalm'
import { useReveal } from './motion/reveal'

const CALL: Record<Verdict['recommendation'], { label: string; fill: string; ink: string }> = {
  go: { label: 'Go', fill: 'var(--color-customer)', ink: 'var(--color-stamp-go)' },
  pivot: { label: 'Pivot', fill: 'var(--color-vc)', ink: 'var(--color-stamp-pivot)' },
  no_go: { label: 'No-go', fill: 'var(--color-competitor)', ink: 'var(--color-stamp-no-go)' },
}
const CONFETTI = ['--color-vc', '--color-customer', '--color-cto', '--color-competitor', '--color-moderator']
const SLAM = { scale: 3.2, rotate: 12, opacity: 0 }

/**
 * The moderator's ruling on paper. The stamp comes down on it and the sheet jumps. A go also throws confetti.
 * The sheet clips sideways: before it lands the stamp is three times its size, and must not widen a phone's page.
 */
export default function RecommendationCard({ verdict, pitch }: { verdict: Verdict; pitch?: string }) {
  const calm = useCalm()
  const { stamp } = useReveal()
  const call = CALL[verdict.recommendation] ?? CALL.pivot
  const pct = Math.round(verdict.confidence * 100)
  const landed = calm || stamp
  return (
    <m.section
      aria-labelledby="rec"
      className="surface relative flex flex-col overflow-x-clip p-5 sm:p-6"
      animate={landed && !calm ? { y: [0, 7, -3, 1, 0], rotate: [0, -0.5, 0.3, 0] } : undefined}
      transition={{ duration: 0.38, ease: 'easeOut', delay: 0.07 }}
    >
      {pitch && (
        <p className="line-clamp-2 text-sm text-muted">
          <span className="font-extrabold">The pitch:</span> {pitch}
        </p>
      )}
      <div className="relative mt-4 flex flex-1 items-center">
        <div className="relative inline-block text-[clamp(5rem,20vw,9.5rem)]" style={{ color: call.ink }}>
          {!landed && <div aria-hidden="true" className="stamp-mark absolute inset-0 -rotate-[4deg]" />}
          <m.div
            className="stamp-slam inline-block"
            style={{ transformOrigin: '40% 60%' }}
            initial={calm ? false : SLAM}
            animate={landed ? { scale: 1, rotate: -4, opacity: 1 } : SLAM}
            transition={{ type: 'spring', stiffness: 700, damping: 19, mass: 0.9 }}
          >
            <div className="stamp">
              <h1 id="rec" className="display leading-[0.95]">{call.label}</h1>
            </div>
          </m.div>
          {landed && !calm && verdict.recommendation === 'go' && CONFETTI.flatMap((c, k) => [0, 1, 2].map((j) => {
            const n = k * 3 + j
            const ang = (n / 15) * Math.PI * 2
            return (
              <m.span
                key={n}
                aria-hidden="true"
                className="pointer-events-none absolute left-[40%] top-1/2 block h-3 w-2 rounded-[1px]"
                style={{ background: `var(${c})`, border: '1.5px solid var(--color-line)' }}
                initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
                animate={{ x: Math.cos(ang) * (120 + (n % 4) * 40), y: Math.sin(ang) * (90 + (n % 3) * 30) + 60, opacity: 0, rotate: 360 + n * 40 }}
                transition={{ duration: 1.3 + (n % 5) * 0.12, ease: 'easeOut' }}
              />
            )
          }))}
        </div>
      </div>
      <p className="mt-4 max-w-xl font-body text-xl leading-snug">{verdict.one_line_summary}</p>
      <div className="mt-4 flex max-w-sm items-center gap-3 text-sm font-bold">
        <div
          className="h-4 flex-1 overflow-hidden rounded-sm border-[3px] border-line bg-panel-hi"
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
    </m.section>
  )
}
