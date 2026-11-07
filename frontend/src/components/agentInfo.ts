import type { AgentId } from '../lib/debateReducer'

/** What the product calls each seat. The ids (vc, cto, ...) are the wire format; these are the words people see. */
export const AGENT_NAME: Record<AgentId, string> = {
  vc: 'Investor',
  customer: 'Customer',
  cto: 'Engineer',
  competitor: 'Rival',
  moderator: 'Moderator',
}

export const ROLE: Record<AgentId, string> = {
  vc: 'Will this return the fund?',
  customer: 'Would I actually pay?',
  cto: 'Can it be built and kept running?',
  competitor: 'Why will you lose to us?',
  moderator: 'Keeps the room honest',
}
