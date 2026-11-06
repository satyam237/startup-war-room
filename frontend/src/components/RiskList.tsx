import type { Risk } from '../lib/debateReducer'

const AGENT_LABELS: Record<string, string> = {
  vc: 'Investor',
  customer: 'Customer',
  cto: 'Engineer',
  competitor: 'Rival',
  moderator: 'Moderator',
}

const SEVERITY: Record<Risk['severity'], string> = { high: 'High', med: 'Medium', low: 'Low' }
const SEV_STYLE: Record<Risk['severity'], string> = {
  high: 'border-competitor text-competitor',
  med: 'border-vc text-vc',
  low: 'border-line text-muted',
}

export default function RiskList({ risks }: { risks: Risk[] }) {
  const ranked = [...risks].sort((a, b) => a.rank - b.rank)
  return (
    <section aria-labelledby="risks-h">
      <h2 id="risks-h" className="font-display text-2xl font-bold">Biggest risks</h2>
      <ol aria-label="Risks" className="mt-3 divide-y divide-line">
        {ranked.map((r) => (
          <li key={r.rank} data-agent={r.raised_by} className="grid grid-cols-[2rem_1fr] gap-x-3 py-3">
            <span className="font-display text-2xl font-black text-muted tabular-nums">{r.rank}</span>
            <div>
              <p className="font-body text-lg leading-snug">{r.risk}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-sm border px-1.5 py-0.5 ${SEV_STYLE[r.severity] ?? SEV_STYLE.low}`}>
                  {SEVERITY[r.severity] ?? r.severity} severity
                </span>
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="inline-block size-2 rounded-full bg-(--agent,var(--color-muted))" aria-hidden="true" />
                  Raised by {AGENT_LABELS[r.raised_by] ?? r.raised_by}
                </span>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
