import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import type { Scorecard as ScorecardData } from '../lib/debateReducer'

const DIMENSIONS: { key: keyof ScorecardData; label: string }[] = [
  { key: 'market', label: 'Market' },
  { key: 'customer_pull', label: 'Customer pull' },
  { key: 'feasibility', label: 'Feasibility' },
  { key: 'defensibility', label: 'Defensibility' },
  { key: 'timing', label: 'Timing' },
]

export default function Scorecard({ scorecard }: { scorecard: ScorecardData }) {
  const data = DIMENSIONS.map(({ key, label }) => ({ label, score: scorecard[key].score }))
  return (
    <section aria-labelledby="scores-h" className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-center">
      <div>
        <h2 id="scores-h" className="font-display text-2xl font-bold">Scorecard</h2>
        {/* Decorative: the list beside it carries the same values for assistive tech. */}
        <div className="mt-2 h-72 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <RadarChart data={data} outerRadius="70%">
              <PolarGrid stroke="#2f3b47" />
              <PolarAngleAxis dataKey="label" tick={{ fill: '#93a1ad', fontSize: 12 }} />
              <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
              <Radar dataKey="score" stroke="#ece7dc" strokeWidth={2} fill="#ece7dc" fillOpacity={0.18} isAnimationActive={false} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ul aria-label="Scores" className="divide-y divide-line">
        {DIMENSIONS.map(({ key, label }) => {
          const { score, why } = scorecard[key]
          return (
            <li key={key} className="grid grid-cols-[4.5rem_1fr] items-baseline gap-x-4 py-3">
              <span className="font-display text-4xl font-black tabular-nums">
                {score}<span className="text-sm font-normal text-muted">/10</span>
              </span>
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block font-body text-muted">{why}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
