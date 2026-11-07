import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import type { Scorecard as ScorecardData } from '../lib/debateReducer'
import CountUp from './motion/CountUp'
import { useCalm } from './motion/useCalm'
import { m } from 'motion/react'

const DIMENSIONS: { key: keyof ScorecardData; label: string }[] = [
  { key: 'market', label: 'Market' },
  { key: 'customer_pull', label: 'Customer pull' },
  { key: 'feasibility', label: 'Feasibility' },
  { key: 'defensibility', label: 'Defensibility' },
  { key: 'timing', label: 'Timing' },
]

/** Bar colour by score band, the same colours as the call itself. */
const tone = (s: number) => (s >= 7 ? 'var(--color-customer)' : s >= 4 ? 'var(--color-vc)' : 'var(--color-competitor)')

/** The radar. It draws itself in; the numbers beside it are in <ScoreList>. */
export function Radar5({ scorecard, call }: { scorecard: ScorecardData; call: string }) {
  const calm = useCalm()
  const data = DIMENSIONS.map(({ key, label }) => ({ label, score: scorecard[key].score }))
  return (
    <section aria-label="Score shape" className="surface p-4" style={{ ['--call' as string]: call }}>
      {/* Decorative: the list carries the same values for assistive tech. */}
      <div className="h-72 w-full sm:h-80" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <RadarChart data={data} outerRadius="68%">
            <PolarGrid className="radar-grid" stroke="var(--color-line)" strokeOpacity={0.45} />
            <PolarAngleAxis dataKey="label" tick={{ fill: 'var(--color-ink)', fontSize: 13, fontWeight: 700 }} />
            <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
            <Radar
              dataKey="score"
              className="radar-shape"
              stroke="var(--color-line)"
              strokeWidth={4}
              fill="var(--call)"
              fillOpacity={0.75}
              dot={{ r: 5, fill: 'var(--color-line)', stroke: 'var(--color-panel)', strokeWidth: 2 }}
              isAnimationActive={!calm}
              animationBegin={250}
              animationDuration={1500}
              animationEasing="ease-out"
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export default function Scorecard({ scorecard }: { scorecard: ScorecardData }) {
  const calm = useCalm()
  return (
    <section aria-labelledby="scores-h">
      <h2 id="scores-h" className="display text-4xl">Scorecard</h2>
      <ul aria-label="Scores" className="mt-4 grid gap-4 lg:grid-cols-2">
        {DIMENSIONS.map(({ key, label }, i) => {
          const { score, why } = scorecard[key]
          return (
            <li
              key={key}
              className={`surface group grid grid-cols-[4.5rem_1fr] items-start gap-x-4 p-4 transition-[transform,box-shadow] duration-150 hover:-translate-y-1 hover:shadow-[8px_8px_0_var(--color-shade)] focus-within:-translate-y-1 ${i === 4 ? 'lg:col-span-2' : ''}`}
              tabIndex={0}
            >
              <span className="display text-6xl leading-none transition-transform duration-150 group-hover:scale-110 group-focus:scale-110" style={{ color: 'var(--color-ink)' }}>
                <CountUp value={score} delay={0.3 + i * 0.14} />
                <span className="text-base font-bold text-muted">/10</span>
              </span>
              <span>
                <span className="block text-lg font-extrabold">{label}</span>
                <span className="mt-1 block h-3 overflow-hidden rounded-full border-[3px] border-line bg-panel-hi" aria-hidden="true">
                  <m.span
                    className="block h-full origin-left"
                    style={{ background: tone(score) }}
                    initial={calm ? false : { scaleX: 0 }}
                    animate={{ scaleX: score / 10 }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.3 + i * 0.14 }}
                  />
                </span>
                <span className="mt-2 block font-body leading-relaxed text-muted">{why}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
