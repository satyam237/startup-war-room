import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Pitch from './Pitch'

const PITCH = 'An app that matches freelance electricians with last-minute jobs near them, with instant payouts.'

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function setup() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Pitch />} />
        <Route path="/d/:id" element={<div>debate room</div>} />
      </Routes>
    </MemoryRouter>,
  )
}
const submit = () => screen.getByRole('button', { name: /start the debate/i })
const box = () => screen.getByLabelText(/your pitch/i)
async function enterPitch() {
  await userEvent.click(box())
  await userEvent.paste(PITCH)
}

describe('Pitch', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('disables submit under 50 and over 2000 chars', async () => {
    setup()
    expect(submit()).toBeDisabled()
    await userEvent.type(box(), 'too short')
    expect(submit()).toBeDisabled()
    await userEvent.clear(box())
    await enterPitch()
    expect(submit()).toBeEnabled()
    await userEvent.clear(box())
    await userEvent.paste('x'.repeat(2001))
    expect(submit()).toBeDisabled()
  })

  it('example chip fills the textarea', async () => {
    setup()
    const chips = screen.getAllByRole('button', { name: /^example:/i })
    expect(chips).toHaveLength(3)
    await userEvent.click(chips[0])
    expect((box() as HTMLTextAreaElement).value.length).toBeGreaterThanOrEqual(50)
    expect(submit()).toBeEnabled()
  })

  it('shows the confidentiality notice', () => {
    setup()
    expect(screen.getByText(/do not paste confidential or proprietary information/i)).toBeInTheDocument()
  })

  it('on 201 stores delete_token and navigates to the room', async () => {
    fetchMock.mockReturnValueOnce(json(201, { debate_id: 'abc', delete_token: 'tok' }))
    setup()
    await enterPitch()
    await userEvent.click(submit())
    await screen.findByText('debate room')
    expect(JSON.parse(localStorage.getItem('swr.deleteTokens')!)).toEqual({ abc: 'tok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/debates')
    expect(JSON.parse(init.body)).toEqual({ pitch: PITCH })
  })

  it('needs_clarification shows questions and resubmits with answers and skip_clarify', async () => {
    fetchMock
      .mockReturnValueOnce(json(200, { status: 'needs_clarification', questions: ['Who pays?', 'Where launch?'] }))
      .mockReturnValueOnce(json(201, { debate_id: 'xyz', delete_token: 't2' }))
    setup()
    await enterPitch()
    await userEvent.click(submit())
    expect(await screen.findByText('Who pays?')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Who pays?'), 'Homeowners')
    await userEvent.type(screen.getByLabelText('Where launch?'), 'Pune')
    await userEvent.click(screen.getByRole('button', { name: /continue to debate/i }))
    await screen.findByText('debate room')
    const body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body.skip_clarify).toBe(true)
    expect(body.pitch).toContain(PITCH)
    expect(body.pitch).toContain('Homeowners')
    expect(body.pitch).toContain('Pune')
  })

  it('429 shows a friendly limit message', async () => {
    fetchMock.mockReturnValueOnce(json(429, { detail: 'rate' }))
    setup()
    await enterPitch()
    await userEvent.click(submit())
    expect(await screen.findByRole('alert')).toHaveTextContent(/limit/i)
    await waitFor(() => expect(submit()).toBeEnabled())
  })

  it('422 shows the server detail', async () => {
    fetchMock.mockReturnValueOnce(json(422, { detail: 'Pitch looks off' }))
    setup()
    await enterPitch()
    await userEvent.click(submit())
    expect(await screen.findByRole('alert')).toHaveTextContent('Pitch looks off')
  })
})
