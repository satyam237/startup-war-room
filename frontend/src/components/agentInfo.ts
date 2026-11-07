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

/** Tonight's opposition, from the real setup events. Absent until the server has named them. */
export function tonight(persona: unknown, competitors: unknown): { customer?: string; rival?: string } {
  const p = persona as { name?: unknown; role?: unknown } | null
  const who = [p?.name, p?.role].filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  const rivals = Array.isArray(competitors) ? competitors.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : []
  return {
    customer: who.length ? who.join(', ') : undefined,
    rival: rivals.length ? rivals.join(', ') : undefined,
  }
}
