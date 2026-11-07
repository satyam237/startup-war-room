import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DebateRoom from './DebateRoom'

class MockEventSource {
  static instances: MockEventSource[] = []
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {}
  closed = false
  readyState = 1
  constructor(public url: string) { MockEventSource.instances.push(this) }
  addEventListener(name: string, fn: (e: MessageEvent) => void) { (this.listeners[name] ??= []).push(fn) }
  close() { this.closed = true }
  emit(name: string, data: unknown, id: number) {
    const e = new MessageEvent(name, { data: JSON.stringify(data), lastEventId: String(id) })
    this.listeners[name]?.forEach((fn) => fn(e))
  }
}

let seq = 0
function emit(name: string, data: unknown) {
  act(() => { MockEventSource.instances.at(-1)!.emit(name, data, ++seq) })
}
const start = (turn_id: string, agent: string, round = 1) => emit('turn_start', { turn_id, agent, round, attempt: 1 })
const end = (turn_id: string, agent: string, text: string, round = 1) => emit('turn_end', { turn_id, agent, round, text })

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function setup() {
  return render(
    <MemoryRouter initialEntries={['/d/abc']}>
      <Routes>
        <Route path="/d/:id" element={<DebateRoom />} />
        <Route path="/d/:id/verdict" element={<div>verdict page</div>} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DebateRoom', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    seq = 0
    MockEventSource.instances = []
    fetchMock.mockReset()
    fetchMock.mockImplementation(() => json(200, { status: 'running', verdict: null }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', MockEventSource)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  async function connected() {
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0))
  }

  it('shows setup messages before any turn', async () => {
    setup()
    await connected()
    emit('setup', { step: 'persona', message: 'Building your customer persona...' })
    expect(screen.getAllByText('Building your customer persona...').length).toBeGreaterThan(0)
  })

  it('highlights the active agent card and clears it when the turn ends', async () => {
    setup()
    await connected()
    start('t1', 'cto')
    expect(screen.getByTestId('agent-cto')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('agent-vc')).toHaveAttribute('data-active', 'false')
    end('t1', 'cto', 'The build is harder than it looks.')
    expect(screen.getByTestId('agent-cto')).toHaveAttribute('data-active', 'false')
    expect(screen.getByText('The build is harder than it looks.')).toBeInTheDocument()
  })

  it('streams tokens into the feed', async () => {
    setup()
    await connected()
    start('t1', 'vc')
    emit('turn_token', { turn_id: 't1', text: 'Margins ' })
    emit('turn_token', { turn_id: 't1', text: 'look thin.' })
    expect(screen.getByText('Margins look thin.')).toBeInTheDocument()
  })

  it('shows the rebuttal box with a countdown, then hides it on rebuttal_received', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    await connected()
    emit('await_rebuttal', { timeout_s: 30 })
    expect(screen.getByRole('textbox', { name: /your rebuttal/i })).toBeInTheDocument()
    expect(screen.getByText(/30s/)).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.getByText(/2[67]s/)).toBeInTheDocument()
    emit('rebuttal_received', { text: 'We target clinics.' })
    expect(screen.queryByRole('textbox', { name: /your rebuttal/i })).not.toBeInTheDocument()
  })

  it('submits the rebuttal text, and Skip submits empty text', async () => {
    setup()
    await connected()
    emit('await_rebuttal', { timeout_s: 60 })
    fetchMock.mockImplementation(() => json(200, { ok: true }))
    await userEvent.type(screen.getByRole('textbox', { name: /your rebuttal/i }), 'Our moat is data')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/rebuttal'))!
    expect(JSON.parse(call[1].body)).toEqual({ text: 'Our moat is data' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /your rebuttal/i })).not.toBeInTheDocument())
  })

  it('Skip sends empty text', async () => {
    setup()
    await connected()
    emit('await_rebuttal', { timeout_s: 60 })
    fetchMock.mockImplementation(() => json(200, { ok: true }))
    await userEvent.click(screen.getByRole('button', { name: /skip/i }))
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/rebuttal'))!
    expect(JSON.parse(call[1].body)).toEqual({ text: '' })
  })

  it('on 409 shows a gentle message and hides the box', async () => {
    setup()
    await connected()
    emit('await_rebuttal', { timeout_s: 60 })
    fetchMock.mockImplementation(() => json(409, { detail: 'closed' }))
    await userEvent.type(screen.getByRole('textbox', { name: /your rebuttal/i }), 'late')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByText(/window had already closed/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /your rebuttal/i })).not.toBeInTheDocument()
  })

  it('renders a turn_failed note and keeps the feed going', async () => {
    setup()
    await connected()
    emit('turn_failed', { agent: 'competitor', round: 1, note: 'The rival lost its train of thought.' })
    expect(screen.getByText('The rival lost its train of thought.')).toBeInTheDocument()
    start('t2', 'vc')
    end('t2', 'vc', 'Still here.')
    expect(screen.getByText('Still here.')).toBeInTheDocument()
  })

  it('shows a checkpoint summary and its disagreements', async () => {
    setup()
    await connected()
    emit('checkpoint', { round: 1, summary: 'Pricing is the crux.', top_disagreements: ['Price too high', 'Market too small'] })
    expect(screen.getAllByText('Pricing is the crux.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Price too high').length).toBeGreaterThan(0)
  })

  it('unrecoverable error shows the message and a link home, and does not go to the verdict', async () => {
    setup()
    await connected()
    emit('error', { message: 'The server restarted and this debate was lost.', recoverable: false })
    emit('done', { status: 'failed' })
    expect(screen.getByText('The server restarted and this debate was lost.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start a new debate/i })).toHaveAttribute('href', '/')
    expect(screen.queryByText('verdict page')).not.toBeInTheDocument()
  })

  it('navigates to the verdict on done complete', async () => {
    setup()
    await connected()
    emit('done', { status: 'complete' })
    expect(await screen.findByText('verdict page')).toBeInTheDocument()
  })

  it('navigates to the verdict on done budget_exceeded', async () => {
    setup()
    await connected()
    emit('done', { status: 'budget_exceeded' })
    expect(await screen.findByText('verdict page')).toBeInTheDocument()
  })

  it('navigates to the verdict on done partial', async () => {
    setup()
    await connected()
    emit('done', { status: 'partial' })
    expect(await screen.findByText('verdict page')).toBeInTheDocument()
  })

  it('redirects to the verdict when the debate is already complete', async () => {
    fetchMock.mockImplementation(() => json(200, { status: 'complete', verdict: { overall: 1 } }))
    setup()
    expect(await screen.findByText('verdict page')).toBeInTheDocument()
  })

  it('after the browser gives up on the stream, goes to the verdict if the debate finished', async () => {
    setup()
    await connected()
    fetchMock.mockImplementation(() => json(200, { status: 'complete', verdict: { overall: 1 } }))
    act(() => {
      const es = MockEventSource.instances.at(-1)!
      es.readyState = 2
      es.listeners.error?.forEach((fn) => fn(new Event('error') as MessageEvent))
    })
    expect(await screen.findByText('verdict page')).toBeInTheDocument()
  })

  it('after the browser gives up on the stream, shows an unrecoverable error with a link home', async () => {
    setup()
    await connected()
    act(() => {
      const es = MockEventSource.instances.at(-1)!
      es.readyState = 2
      es.listeners.error?.forEach((fn) => fn(new Event('error') as MessageEvent))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(/connection to this debate was lost/i)
    expect(screen.getByRole('link', { name: /start a new debate/i })).toHaveAttribute('href', '/')
  })

  it('closes the stream on unmount', async () => {
    const { unmount } = setup()
    await connected()
    const es = MockEventSource.instances[0]
    unmount()
    expect(es.closed).toBe(true)
  })

  it('renders a Round 3 turn_end with the real final_position object shape', async () => {
    setup()
    await connected()
    start('t9', 'competitor', 3)
    emit('turn_end', {
      turn_id: 't9', agent: 'competitor', round: 3, text: 'Final word.',
      final_position: { score_1_to_10: 3, top_risk: 'Incumbents copy it in a quarter', change_mind_if: 'A signed anchor customer' },
    })
    const card = screen.getByTestId('agent-competitor')
    expect(card).toHaveTextContent('3')
    expect(card).toHaveTextContent('Incumbents copy it in a quarter')
    expect(card).toHaveTextContent('A signed anchor customer')
  })

  it('lists real setup steps and says how long the wait has been, before the first turn', async () => {
    setup()
    await connected()
    expect(screen.getByTestId('setup-stage')).toHaveTextContent(/connecting/i)
    emit('setup', { step: 'persona', message: 'Building your customer persona...' })
    emit('setup', { step: 'competitors', message: 'Scouting competitors...' })
    const stage = screen.getByTestId('setup-stage')
    expect(stage).toHaveTextContent('Building your customer persona...')
    expect(stage).toHaveTextContent('Scouting competitors...')
    expect(stage.querySelector('[data-step-state="active"]')).toHaveTextContent('Scouting competitors...')
    expect(stage.querySelector('[data-step-state="done"]')).toHaveTextContent('Building your customer persona...')
    start('t1', 'vc')
    expect(screen.queryByTestId('setup-stage')).not.toBeInTheDocument()
  })

  it('slams a round title when a new round begins, and shows no score before round 3', async () => {
    setup()
    await connected()
    start('t1', 'vc', 1)
    expect(screen.getByTestId('round-title')).toHaveTextContent(/round\s*1/i)
    end('t1', 'vc', 'One.', 1)
    start('t2', 'cto', 2)
    expect(screen.getByTestId('round-title')).toHaveTextContent(/round\s*2/i)
    expect(screen.getByTestId('agent-vc')).not.toHaveTextContent(/out of 10/)
  })

  it('rings the bell at a checkpoint and fills the round meter from real turns', async () => {
    setup()
    await connected()
    start('t1', 'vc'); end('t1', 'vc', 'One.')
    start('t2', 'cto'); end('t2', 'cto', 'Two.')
    const meter = screen.getByRole('progressbar', { name: /debate progress/i })
    expect(meter.querySelectorAll('[data-filled="true"]').length).toBe(2)
    expect(screen.queryAllByTestId('bell')).toHaveLength(0)
    emit('checkpoint', { round: 1, summary: 'Pricing is the crux.', top_disagreements: ['Price too high', 'Price too low'] })
    expect(screen.getAllByTestId('bell').length).toBeGreaterThan(0)
    expect(screen.getByText('Round 1 of 3')).toBeInTheDocument()
  })

  it('builds pressure in the last seconds of the rebuttal window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    await connected()
    emit('await_rebuttal', { timeout_s: 30 })
    const box = screen.getByRole('timer').closest('form')!
    expect(box).toHaveAttribute('data-pressure', 'calm')
    act(() => { vi.advanceTimersByTime(21000) })
    expect(box).toHaveAttribute('data-pressure', 'rising')
    act(() => { vi.advanceTimersByTime(7000) })
    expect(box).toHaveAttribute('data-pressure', 'critical')
  })
})
