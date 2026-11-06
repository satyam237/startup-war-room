import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import Verdict from './Verdict'
import type { Verdict as VerdictData } from '../lib/debateReducer'

class RO { observe() {} unobserve() {} disconnect() {} }

const verdict: VerdictData = {
  recommendation: 'pivot',
  confidence: 0.72,
  scorecard: {
    market: { score: 8, why: 'Large and growing trade.' },
    customer_pull: { score: 6, why: 'Pain is real but episodic.' },
    feasibility: { score: 7, why: 'Standard stack.' },
    defensibility: { score: 3, why: 'Easy to copy.' },
    timing: { score: 5, why: 'Neutral.' },
  },
  risks: [1, 2, 3, 4, 5].map((n) => ({
    rank: n, risk: `Risk number ${n}`, severity: n < 3 ? 'high' : 'med', raised_by: ['vc', 'customer', 'cto', 'competitor', 'vc'][n - 1],
  })),
  experiments: [1, 2, 3].map((n) => ({
    test: `Experiment ${n}`, timebox_days: n * 5, success_criteria: `Win ${n}`, kill_criteria: `Kill ${n}`,
  })),
  one_line_summary: 'Narrow to emergency jobs first.',
  fallback: false,
}
const debate = { id: 'abc', pitch: 'My electrician pitch', status: 'complete', verdict }

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}
function Home() {
  const l = useLocation()
  return <div data-testid="home">{(l.state as { pitch?: string } | null)?.pitch}</div>
}

function setup() {
  render(
    <MemoryRouter initialEntries={['/d/abc/verdict']}>
      <Routes>
        <Route path="/d/:id/verdict" element={<Verdict />} />
        <Route path="/d/:id" element={<div>debate room</div>} />
        <Route path="/" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Verdict page', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', RO)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows recommendation, confidence, summary, all five scores and the disclaimer', async () => {
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    expect(await screen.findByRole('heading', { name: /pivot/i })).toBeInTheDocument()
    expect(screen.getByText(/72%/)).toBeInTheDocument()
    expect(screen.getByText('Narrow to emergency jobs first.')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: /scores/i })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[0]).toHaveTextContent(/market/i)
    expect(items[0]).toHaveTextContent('8')
    expect(items[3]).toHaveTextContent('Easy to copy.')
    expect(screen.getByText(/brainstorming, not professional advice/i)).toBeInTheDocument()
  })

  it('lists five risks in rank order with the agent who raised each', async () => {
    fetchMock.mockReturnValue(json(200, { ...debate, verdict: { ...verdict, risks: [...verdict.risks].reverse() } }))
    setup()
    const list = await screen.findByRole('list', { name: /risks/i })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[0]).toHaveTextContent('Risk number 1')
    expect(items[0]).toHaveTextContent(/investor/i)
    expect(items[4]).toHaveTextContent('Risk number 5')
    expect(items[1]).toHaveTextContent(/customer/i)
  })

  it('lists three experiments with success and kill criteria', async () => {
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    const list = await screen.findByRole('list', { name: /experiments/i })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[1]).toHaveTextContent('Experiment 2')
    expect(items[1]).toHaveTextContent('10 days')
    expect(items[1]).toHaveTextContent('Win 2')
    expect(items[1]).toHaveTextContent('Kill 2')
  })

  it('copies the share URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    await screen.findByRole('heading', { name: /pivot/i })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await userEvent.click(screen.getByRole('button', { name: /share/i }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/d/abc/verdict`)
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument()
  })

  it('links export to the markdown endpoint', async () => {
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    const link = await screen.findByRole('link', { name: /export markdown/i })
    expect(link).toHaveAttribute('href', '/debates/abc/export?format=md')
  })

  it('hides Delete without a stored token', async () => {
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    await screen.findByRole('heading', { name: /pivot/i })
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('deletes using the stored token and returns home', async () => {
    localStorage.setItem('swr.deleteTokens', JSON.stringify({ abc: 'tok123' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchMock.mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? Promise.resolve(new Response(null, { status: 204 })) : json(200, debate))
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /delete/i }))
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument())
    const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')!
    expect(call[1].headers['X-Delete-Token']).toBe('tok123')
  })

  it('run again returns to the pitch page prefilled', async () => {
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /run again with changes/i }))
    expect(screen.getByTestId('home')).toHaveTextContent('My electrician pitch')
  })

  it('submits a 1 to 5 rating', async () => {
    fetchMock.mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === 'POST' ? Promise.resolve(new Response(null, { status: 204 })) : json(200, debate))
    setup()
    await userEvent.click(await screen.findByRole('radio', { name: /4 of 5/i }))
    await userEvent.type(screen.getByLabelText(/comment/i), 'sharp')
    await userEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    expect(await screen.findByText(/thanks for the feedback/i)).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(call[0]).toBe('/debates/abc/feedback')
    expect(JSON.parse(call[1].body)).toEqual({ rating: 4, comment: 'sharp' })
  })

  it('shows a partial-result notice for a fallback verdict', async () => {
    fetchMock.mockReturnValue(json(200, { ...debate, verdict: { ...verdict, fallback: true } }))
    setup()
    expect(await screen.findByText(/partial result/i)).toBeInTheDocument()
  })

  it('shows a partial-result notice when the budget was exceeded', async () => {
    fetchMock.mockReturnValue(json(200, { ...debate, status: 'budget_exceeded' }))
    setup()
    expect(await screen.findByText(/partial result/i)).toBeInTheDocument()
  })

  it('handles a missing debate', async () => {
    fetchMock.mockReturnValue(json(404, { detail: 'Not found' }))
    setup()
    expect(await screen.findByText(/debate not found/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start a new debate/i })).toHaveAttribute('href', '/')
  })

  it('links to the room when there is no verdict yet', async () => {
    fetchMock.mockReturnValue(json(200, { ...debate, status: 'running', verdict: null }))
    setup()
    expect(await screen.findByText(/no verdict yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to the room/i })).toHaveAttribute('href', '/d/abc')
  })
})
