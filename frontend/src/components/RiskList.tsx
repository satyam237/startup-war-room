import type { Risk } from '../lib/debateReducer'
import { AGENT_NAME } from './agentInfo'
import { CascadeItem } from './motion/reveal'
import { agentOf } from './PanelRow'

const SEVERITY: Record<Risk['severity'], string> = { high: 'High', med: 'Medium', low: 'Low' }
const SEV_FILL: Record<Risk['severity'], string> = {
  high: 'var(--color-competitor)',
  med: 'var(--color-vc)',
  low: 'var(--color-panel-hi)',
}

interface Props {
  risks: Risk[]
  lit: string | null
  onLit: (agent: string | null) => void
}

export default function RiskList({ risks, lit, onLit }: Props) {
  const ranked = [...risks].sort((a, b) => a.rank - b.rank)
  return (
    <section aria-labelledby="risks-h">
      <h2 id="risks-h" className="display text-4xl">Biggest risks</h2>
      <ol aria-label="Risks" className="mt-4 space-y-4">
        {ranked.map((r, i) => {
          const agent = agentOf(r.raised_by)
          const on = lit === agent
          return (
            <CascadeItem
              key={r.rank}
              index={i}
              data-agent={agent}
              data-lit={on}
              onPointerEnter={() => onLit(agent)}
              onPointerLeave={() => onLit(null)}
              className="surface grid grid-cols-[3.5rem_1fr] gap-x-4 p-4 transition-[box-shadow,transform] duration-150"
              style={on ? { boxShadow: '8px 8px 0 var(--agent)', transform: 'translate(-2px,-2px)' } : lit ? { opacity: 0.6 } : undefined}
            >
              <span className="display grid size-14 place-items-center rounded-md border-[3px] border-line text-4xl text-fill-ink" style={{ background: SEV_FILL[r.severity] ?? SEV_FILL.low }}>
                {r.rank}
              </span>
              <div>
                <p className="font-body text-lg leading-snug">{r.risk}</p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-md border-[3px] border-line px-2 py-0.5 font-extrabold" style={{ background: SEV_FILL[r.severity] ?? SEV_FILL.low, color: 'var(--color-fill-ink)' }}>
                    {SEVERITY[r.severity] ?? r.severity} severity
                  </span>
                  <button
                    type="button"
                    onFocus={() => onLit(agent)}
                    onBlur={() => onLit(null)}
                    className="group/by flex items-center gap-1.5 rounded-md px-1 font-bold text-(--agent-ink,var(--color-muted)) underline decoration-2 underline-offset-4 decoration-transparent transition-[text-decoration-color] hover:decoration-current focus-visible:decoration-current"
                  >
                    <span className="inline-block size-3 rounded-full border-2 border-line bg-(--agent,var(--color-muted)) transition-transform group-hover/by:scale-150" aria-hidden="true" />
                    Raised by {AGENT_NAME[agent as keyof typeof AGENT_NAME] ?? r.raised_by}
                  </button>
                </p>
              </div>
            </CascadeItem>
          )
        })}
      </ol>
    </section>
  )
}
