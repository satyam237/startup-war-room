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

/** The radar and the five numbers, up top so the count-up plays where the visitor is looking. The full list with reasons is <Scorecard>. */
export function Radar5({ scorecard, call }: { scorecard: ScorecardData; call: string }) {
  const calm = useCalm()
  const data = DIMENSIONS.map(({ key, label }) => ({ label, score: scorecard[key].score }))
  return (
    <section aria-label="Score shape" className="surface flex flex-col p-4" style={{ ['--call' as string]: call }}>
      {/* Decorative: the score list carries the same values for assistive tech. */}
      <div className="h-64 w-full sm:h-72 lg:h-auto lg:min-h-64 lg:flex-1" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid className="radar-grid" stroke="var(--color-line)" strokeOpacity={0.45} />
            <PolarAngleAxis dataKey="label" tick={{ fill: 'var(--color-ink)', fontSize: 13, fontWeight: 700 }} />
            <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
            <Radar
              dataKey="score"
              className="radar-shape"
              stroke="var(--color-line)"
              strokeWidth={4}
              fill="var(--call)"
              fillOpacity={0.8}
              dot={{ r: 5, fill: 'var(--color-line)', stroke: 'var(--color-panel)', strokeWidth: 2 }}
              isAnimationActive={!calm}
              animationBegin={250}
              animationDuration={1500}
              animationEasing="ease-out"
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <dl aria-hidden="true" className="mt-2 grid grid-cols-3 gap-x-2 gap-y-2 sm:grid-cols-5">
        {DIMENSIONS.map(({ key, label }, i) => (
          <div key={key} className="flex flex-col-reverse items-center text-center">
            <dt className="text-xs font-bold text-muted">{label}</dt>
            <dd className="display text-4xl"><CountUp value={scorecard[key].score} delay={0.3 + i * 0.14} /></dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Tale of the tape: one sheet, five rows, each with its reasoning. */
export default function Scorecard({ scorecard }: { scorecard: ScorecardData }) {
  const calm = useCalm()
  return (
    <section aria-labelledby="scores-h">
      <h2 id="scores-h" className="display text-5xl">Scorecard</h2>
      <ul aria-label="Scores" className="surface mt-4 divide-y-[3px] divide-line">
        {DIMENSIONS.map(({ key, label }, i) => {
          const { score, why } = scorecard[key]
          return (
            <li
              key={key}
              className="group relative grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-panel-hi focus:bg-panel-hi sm:px-5 lg:grid-cols-[5rem_13rem_minmax(0,1fr)] lg:gap-x-6"
              tabIndex={0}
            >
              <span className="display text-6xl leading-none transition-transform duration-150 group-hover:scale-110 group-focus:scale-110">
                <CountUp value={score} delay={0.15 + i * 0.1} />
                <span className="font-ui text-base font-bold normal-case text-muted">/10</span>
              </span>
              <span>
                <span className="display block text-3xl">{label}</span>
                <span className="relative mt-1.5 block h-3.5 overflow-hidden rounded-sm border-[3px] border-line bg-panel-hi" aria-hidden="true">
                  <m.span
                    className="block h-full origin-left"
                    style={{ background: tone(score) }}
                    initial={calm ? false : { scaleX: 0 }}
                    animate={{ scaleX: score / 10 }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.15 + i * 0.1 }}
                  />
                  <span className="absolute inset-0" style={{ background: 'repeating-linear-gradient(90deg, transparent 0 calc(10% - 2px), var(--color-line) calc(10% - 2px) 10%)' }} />
                </span>
              </span>
              <span className="col-span-2 font-body leading-relaxed lg:col-span-1">{why}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
