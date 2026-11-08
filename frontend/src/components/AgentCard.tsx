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
  /** What this fighter last finished saying. */
  said?: string
  /** Who this fighter is tonight, from the setup events. */
  tonight?: string
  /** The room is still being set up. */
  warming?: boolean
}

/** One fighter's corner. While its turn streams the whole card fills with its colour, and an equaliser runs. */
export default function AgentCard({ agent, active, turns, latest, said, tonight, warming = false }: Props) {
  const calm = useCalm()
  return (
    <m.section
      data-agent={agent}
      data-testid={`agent-${agent}`}
      data-active={active}
      aria-label={AGENT_NAME[agent]}
      className="surface relative"
      animate={calm ? undefined : { y: active ? -4 : 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
      style={active ? { background: 'var(--agent)', color: 'var(--color-fill-ink)', boxShadow: '6px 6px 0 var(--color-shade)' } : undefined}
    >
      {active && !calm && (
        <>
          <span aria-hidden="true" className="pulse-ring pointer-events-none absolute -inset-1.5 rounded border-[3px] border-(--agent)" />
          <span aria-hidden="true" className="pulse-ring pointer-events-none absolute -inset-1.5 rounded border-[3px] border-(--agent)" style={{ animationDelay: '0.7s' }} />
        </>
      )}
      <div
        className="flex items-center gap-2.5 bg-(--agent) px-3 py-2 text-fill-ink"
      >
        <span className={warming ? 'warmup' : ''}><FighterGlyph agent={agent} className="size-9 shrink-0" /></span>
        <h2 className="display min-w-0 text-[2rem]">{AGENT_NAME[agent]}</h2>
        {active && <span className="eq ml-auto shrink-0" aria-hidden="true"><i /><i /><i /><i /></span>}
      </div>
      <div className="border-t-[3px] border-line px-3 py-2.5">
        <p className={`flex items-baseline justify-between gap-2 text-xs font-extrabold ${active ? '' : 'text-muted'}`}>
          <span className="min-w-0">{tonight ?? ROLE[agent]}</span>
          <span className="shrink-0">{active ? 'Speaking' : turns ? `${turns} ${turns === 1 ? 'turn' : 'turns'}` : 'Waiting'}</span>
        </p>
        {said && !latest?.finalPosition && (
          <p aria-hidden="true" className="mt-2 line-clamp-4 font-body text-sm italic leading-snug">&ldquo;{said}&rdquo;</p>
        )}
        {latest?.finalPosition && (
          <m.div
            className="mt-2.5 space-y-1.5 border-t-[3px] border-line pt-2.5 font-body text-sm leading-snug"
            initial={calm ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="flex items-baseline gap-2">
              <m.span
                className="display inline-block rounded border-[3px] border-line bg-(--agent) px-2 py-0.5 text-3xl text-fill-ink"
                initial={calm ? false : { scale: 2.4, rotate: -14 }}
                animate={{ scale: 1, rotate: -3 }}
                transition={{ type: 'spring', stiffness: 500, damping: 14 }}
              >
                {latest.finalPosition.score_1_to_10}
              </m.span>
              <span className="font-ui font-semibold text-muted">out of 10</span>
            </p>
            <p>{latest.finalPosition.top_risk}</p>
            <p className={active ? '' : 'text-muted'}>Changes my mind: {latest.finalPosition.change_mind_if}</p>
          </m.div>
        )}
      </div>
    </m.section>
  )
}
