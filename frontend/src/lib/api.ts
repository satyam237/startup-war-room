import type { Verdict } from './debateReducer'

export const API_BASE: string = import.meta.env.VITE_API_URL ?? ''

export interface CreateDebateBody {
  pitch: string
  target_user?: string
  pricing?: string
  stage?: string
  skip_clarify?: boolean
}

export type CreateDebateResult =
  | { kind: 'needs_clarification'; questions: string[] }
  | { kind: 'created'; debateId: string; deleteToken: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const FRIENDLY: Record<number, string> = {
  429: 'You have hit the hourly debate limit. Try again in a while.',
  503: 'The war room is at capacity right now. Try again in a minute.',
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (res.ok) return res
  let detail = ''
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') detail = body.detail
  } catch { /* non-JSON error body */ }
  throw new ApiError(res.status, FRIENDLY[res.status] ?? (detail || `Request failed (${res.status}).`))
}

const jsonInit = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

export async function createDebate(body: CreateDebateBody): Promise<CreateDebateResult> {
  const res = await request('/debates', jsonInit('POST', body))
  const data = await res.json()
  if (res.status === 200 && data.status === 'needs_clarification') {
    return { kind: 'needs_clarification', questions: data.questions ?? [] }
  }
  return { kind: 'created', debateId: data.debate_id, deleteToken: data.delete_token }
}

export interface DebateRecord {
  id: string
  pitch: string
  status: string
  verdict?: Verdict | null
  [key: string]: unknown
}

export async function getDebate(id: string): Promise<DebateRecord> {
  return (await request(`/debates/${encodeURIComponent(id)}`)).json()
}

export async function submitRebuttal(id: string, text: string): Promise<void> {
  await request(`/debates/${encodeURIComponent(id)}/rebuttal`, jsonInit('POST', { text }))
}

export async function deleteDebate(id: string, deleteToken: string): Promise<void> {
  await request(`/debates/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-Delete-Token': deleteToken } })
}

export async function sendFeedback(id: string, rating: number, comment?: string): Promise<void> {
  await request(`/debates/${encodeURIComponent(id)}/feedback`, jsonInit('POST', { rating, comment }))
}

const TOKENS_KEY = 'swr.deleteTokens'

export function getDeleteTokens(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') } catch { return {} }
}

export const exportUrl = (id: string): string => `${API_BASE}/debates/${encodeURIComponent(id)}/export?format=md`

export function saveDeleteToken(debateId: string, token: string): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify({ ...getDeleteTokens(), [debateId]: token }))
}
