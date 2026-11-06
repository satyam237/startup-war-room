import type { Verdict } from '../lib/debateReducer'

const CALL: Record<Verdict['recommendation'], { label: string; color: string }> = {
  go: { label: 'Go', color: 'text-customer' },
  pivot: { label: 'Pivot', color: 'text-vc' },
  no_go: { label: 'No go', color: 'text-competitor' },
}

export default function RecommendationCard({ verdict }: { verdict: Verdict }) {
  const call = CALL[verdict.recommendation] ?? CALL.pivot
  const pct = Math.round(verdict.confidence * 100)
  return (
    <section aria-labelledby="rec" className={`border-l-8 border-current pl-5 sm:pl-8 ${call.color}`}>
      <p className="text-sm text-muted">The moderator's call</p>
      <h1 id="rec" className="font-display text-7xl font-black leading-[0.9] tracking-tight [font-stretch:75%] sm:text-9xl">
        {call.label}
      </h1>
      <p className="mt-4 max-w-xl font-body text-xl leading-relaxed text-ink">{verdict.one_line_summary}</p>
      <div className="mt-5 flex max-w-sm items-center gap-3 text-sm text-muted">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
          role="meter"
          aria-label="Confidence"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
        </div>
        <span>{pct}% confident</span>
      </div>
    </section>
  )
}
