import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import Verdict from './Verdict'
import { stubMatchMedia } from '../test-utils'
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
    rank: n, risk: `Risk number ${n}`, severity: n < 3 ? 'high' : 'med', raised_by: ['VC', 'Customer', 'CTO', 'Competitor', 'VC'][n - 1],
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

  it('reaches its final state at once when the visitor prefers reduced motion', async () => {
    stubMatchMedia(true)
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    await screen.findByRole('heading', { name: /pivot/i })
    expect(screen.getByRole('main')).toHaveAttribute('data-revealed', 'true')
    const items = within(screen.getByRole('list', { name: /scores/i })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('8')
    expect(items[3]).toHaveTextContent('3')
  })

  it('with motion on, the staged reveal still lands on the same final numbers', async () => {
    stubMatchMedia(false)
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    await screen.findByRole('heading', { name: /pivot/i })
    expect(screen.getByRole('main')).toHaveAttribute('data-revealed', 'false')
    await waitFor(() => expect(screen.getByRole('main')).toHaveAttribute('data-revealed', 'true'), { timeout: 8000 })
    const items = within(screen.getByRole('list', { name: /scores/i })).getAllByRole('listitem')
    expect(items.map((li) => li.querySelector('[data-score]')?.textContent)).toEqual(['8', '6', '7', '3', '5'])
  }, 12000)

  it('hovering a risk lights the agent who raised it, and hovering an agent lights their risks', async () => {
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    const risks = await screen.findByRole('list', { name: 'Risks' })
    const panel = screen.getByRole('group', { name: /the panel/i })
    const chip = (a: string) => panel.querySelector(`[data-agent="${a}"]`)!
    await userEvent.hover(within(risks).getAllByRole('listitem')[2])
    expect(chip('cto')).toHaveAttribute('data-lit', 'true')
    expect(chip('vc')).toHaveAttribute('data-lit', 'false')
    await userEvent.unhover(within(risks).getAllByRole('listitem')[2])
    expect(chip('cto')).toHaveAttribute('data-lit', 'false')
    await userEvent.hover(chip('vc').querySelector('button')!)
    expect(within(risks).getAllByRole('listitem').filter((li) => li.getAttribute('data-lit') === 'true')).toHaveLength(2)
  })

  it('shows go and no-go as their own stamps', async () => {
    fetchMock.mockReturnValue(json(200, { ...debate, verdict: { ...verdict, recommendation: 'no_go' } }))
    setup()
    expect(await screen.findByRole('heading', { name: /no-go/i })).toBeInTheDocument()
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

  it('shows a partial-result notice on a partial debate with a real verdict', async () => {
    fetchMock.mockReturnValue(json(200, { ...debate, status: 'partial' }))
    setup()
    expect(await screen.findByText(/partial result/i)).toBeInTheDocument()
  })

  it('labels risks by agent whatever the case of raised_by', async () => {
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    const risks = await screen.findByRole('list', { name: 'Risks' })
    expect(within(risks).getAllByText(/raised by investor/i)).toHaveLength(2)
    expect(within(risks).getByText(/raised by engineer/i)).toBeInTheDocument()
    expect(within(risks).getByText(/raised by rival/i)).toBeInTheDocument()
    expect(risks.querySelector('[data-agent="cto"]')).not.toBeNull()
  })

  it('tells a share link that the debate failed instead of promising a verdict', async () => {
    fetchMock.mockReturnValue(json(200, { ...debate, status: 'failed', verdict: null }))
    setup()
    expect(await screen.findByRole('heading', { name: /this debate failed/i })).toBeInTheDocument()
    expect(screen.queryByText(/still working/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start a new debate/i })).toHaveAttribute('href', '/')
  })

  it('shows its own message when feedback is rate limited', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json(429, { detail: 'Too many' }) : json(200, debate))
    setup()
    await userEvent.click(await screen.findByRole('radio', { name: '4 of 5' }))
    await userEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/feedback/i)
    expect(alert).not.toHaveTextContent(/debate limit/i)
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

  it('offers a broadcast replay of a finished debate on its share link, without playing it', async () => {
    const speak = vi.fn()
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => [] })
    fetchMock.mockReturnValue(json(200, {
      ...debate,
      rebuttal: null,
      turns: [{ id: 1, round: 1, agent: 'vc', text: 'Will this return the fund?', details: null }],
    }))
    setup()
    expect(await screen.findByRole('heading', { name: /replay the fight/i })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/debates/abc'), undefined)
    const captions = within(screen.getByRole('list', { name: 'Broadcast captions' })).getAllByRole('listitem')
    expect(captions.map((c) => c.textContent)).toEqual([
      expect.stringContaining("Tonight's pitch"),
      expect.stringContaining('Round 1.'),
      expect.stringContaining('Will this return the fund?'),
      expect.stringContaining('The verdict. Pivot.'),
    ])
    expect(speak).not.toHaveBeenCalled()
  })

  it('shows no replay when the record has no stored turns', async () => {
    fetchMock.mockReturnValue(json(200, debate))
    setup()
    await screen.findByRole('heading', { name: /pivot/i })
    expect(screen.queryByRole('heading', { name: /replay the fight/i })).not.toBeInTheDocument()
  })
})
