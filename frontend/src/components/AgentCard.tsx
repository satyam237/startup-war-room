import type { AgentId, Turn } from '../lib/debateReducer'

export const AGENT_NAME: Record<AgentId, string> = {
  vc: 'Investor',
  customer: 'Customer',
  cto: 'Engineer',
  competitor: 'Rival',
  moderator: 'Moderator',
}

const ROLE: Record<AgentId, string> = {
  vc: 'Will this return the fund?',
  customer: 'Would I actually pay?',
  cto: 'Can it be built and kept running?',
  competitor: 'Why will you lose to us?',
  moderator: 'Keeps the room honest',
}

interface Props {
  agent: AgentId
  active: boolean
  turns: number
  latest?: Turn
}

/** One seat at the table. Lights up in its own colour while its turn is streaming. */
export default function AgentCard({ agent, active, turns, latest }: Props) {
  return (
    <section
      data-agent={agent}
      data-testid={`agent-${agent}`}
      data-active={active}
      aria-label={AGENT_NAME[agent]}
      className={`rounded-sm border-l-4 border-(--agent) px-4 py-3 transition-colors ${
        active ? 'bg-panel-hi shadow-[0_0_0_1px_var(--agent)]' : 'bg-panel opacity-80'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold leading-none text-(--agent)">{AGENT_NAME[agent]}</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {active && <span className="speaking-dot h-2 w-2 rounded-full bg-(--agent)" aria-hidden="true" />}
          {active ? 'Speaking' : turns ? `${turns} ${turns === 1 ? 'turn' : 'turns'}` : 'Waiting'}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{ROLE[agent]}</p>
      {latest?.finalPosition && (
        <div className="mt-2 space-y-1 border-t border-line pt-2 font-body text-sm leading-snug">
          <p>
            <span className="font-display text-base font-extrabold text-(--agent)">{latest.finalPosition.score_1_to_10}</span>
            <span className="text-muted"> out of 10</span>
          </p>
          <p>{latest.finalPosition.top_risk}</p>
          <p className="text-muted">Changes my mind: {latest.finalPosition.change_mind_if}</p>
        </div>
      )}
    </section>
  )
}
