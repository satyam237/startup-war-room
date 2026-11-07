import { m } from 'motion/react'
import type { AgentId, Turn } from '../lib/debateReducer'
import { AGENT_NAME, ROLE } from './agentInfo'
import FighterGlyph from './FighterGlyph'
import { useCalm } from './motion/useCalm'

export { AGENT_NAME }

interface Props {
  agent: AgentId
  active: boolean
  turns: number
  latest?: Turn
}

/** One fighter's corner. While its turn streams it lifts, glows in its own colour and shows an equaliser. */
export default function AgentCard({ agent, active, turns, latest }: Props) {
  const calm = useCalm()
  return (
    <m.section
      data-agent={agent}
      data-testid={`agent-${agent}`}
      data-active={active}
      aria-label={AGENT_NAME[agent]}
      className="surface relative"
      animate={calm ? undefined : { y: active ? -6 : 0, scale: active ? 1.025 : 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
      style={active ? { boxShadow: '8px 8px 0 var(--agent)', borderColor: 'var(--color-line)' } : undefined}
    >
      {active && !calm && (
        <>
          <span aria-hidden="true" className="pulse-ring pointer-events-none absolute -inset-1.5 rounded-xl border-[3px] border-(--agent)" />
          <span aria-hidden="true" className="pulse-ring pointer-events-none absolute -inset-1.5 rounded-xl border-[3px] border-(--agent)" style={{ animationDelay: '0.7s' }} />
        </>
      )}
      <div
        className="flex items-center gap-3 rounded-t-[6px] bg-(--agent) px-3 py-2 text-fill-ink transition-[filter] duration-300"
        style={{ filter: active || turns > 0 ? undefined : 'saturate(0.55)' }}
      >
        <FighterGlyph agent={agent} className="size-9 shrink-0" />
        <h2 className="display text-3xl">{AGENT_NAME[agent]}</h2>
        <span className="ml-auto flex items-center gap-1.5 text-xs font-extrabold">
          {active && <span className="eq" aria-hidden="true"><i /><i /><i /><i /></span>}
          {active ? 'Speaking' : turns ? `${turns} ${turns === 1 ? 'turn' : 'turns'}` : 'Waiting'}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold text-muted">{ROLE[agent]}</p>
        {latest?.finalPosition && (
          <m.div
            className="mt-3 space-y-1.5 border-t-[3px] border-line pt-3 font-body text-sm leading-snug"
            initial={calm ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="flex items-baseline gap-2">
              <m.span
                className="display inline-block rounded-md border-[3px] border-line bg-(--agent) px-2 py-0.5 text-3xl text-fill-ink"
                initial={calm ? false : { scale: 2.4, rotate: -14 }}
                animate={{ scale: 1, rotate: -3 }}
                transition={{ type: 'spring', stiffness: 500, damping: 14 }}
              >
                {latest.finalPosition.score_1_to_10}
              </m.span>
              <span className="font-ui font-semibold text-muted">out of 10</span>
            </p>
            <p>{latest.finalPosition.top_risk}</p>
            <p className="text-muted">Changes my mind: {latest.finalPosition.change_mind_if}</p>
          </m.div>
        )}
      </div>
    </m.section>
  )
}
