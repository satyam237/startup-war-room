import { m } from 'motion/react'
import type { AgentId, Risk } from '../lib/debateReducer'
import { AGENT_NAME } from './agentInfo'
import FighterGlyph from './FighterGlyph'
import { useCalm } from './motion/useCalm'

export const PANEL: AgentId[] = ['vc', 'customer', 'cto', 'competitor', 'moderator']

/** Verdict risks name critics as VC, Customer, CTO, Competitor; map any casing to an agent id. */
export const agentOf = (raisedBy: string): string => raisedBy.trim().toLowerCase()

interface Props {
  risks: Risk[]
  /** The agent currently highlighted, from hovering a risk or a chip. */
  lit: string | null
  onLit: (agent: string | null) => void
}

/** The five who argued it. Hover or focus one to light the risks they raised; hover a risk to light them. */
export default function PanelRow({ risks, lit, onLit }: Props) {
  const calm = useCalm()
  return (
    <div role="group" aria-label="The panel" className="flex flex-wrap gap-3">
      {PANEL.map((a) => {
        const n = risks.filter((r) => agentOf(r.raised_by) === a).length
        const on = lit === a
        return (
          <m.div
            key={a}
            data-agent={a}
            data-lit={on}
            animate={calm ? undefined : { y: on ? -6 : 0, scale: on ? 1.07 : 1, opacity: lit && !on ? 0.55 : 1 }}
            transition={{ type: 'spring', stiffness: 460, damping: 20 }}
          >
            <button
              type="button"
              onPointerEnter={() => onLit(a)}
              onPointerLeave={() => onLit(null)}
              onFocus={() => onLit(a)}
              onBlur={() => onLit(null)}
              className="surface flex items-center gap-2 !rounded-full py-1.5 pl-1.5 pr-4 text-left transition-colors"
              style={on ? { background: 'var(--agent)', color: 'var(--color-fill-ink)', boxShadow: '5px 5px 0 var(--color-shade)' } : undefined}
            >
              <span className="grid size-9 place-items-center rounded-full border-[3px] border-line bg-(--agent) text-fill-ink">
                <FighterGlyph agent={a} className="size-5" />
              </span>
              <span>
                <span className="block text-sm font-extrabold leading-tight">{AGENT_NAME[a]}</span>
                <span className={`block text-xs font-semibold leading-tight ${on ? '' : 'text-muted'}`}>
                  {a === 'moderator' ? 'Referee' : `${n} ${n === 1 ? 'risk' : 'risks'} raised`}
                </span>
              </span>
            </button>
          </m.div>
        )
      })}
    </div>
  )
}
