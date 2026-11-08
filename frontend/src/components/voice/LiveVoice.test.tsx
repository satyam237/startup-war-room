import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer, type Dispatch } from 'react'
import { debateReducer, initialDebateState, type DebateAction } from '../../lib/debateReducer'
import { HD_CONSENT_KEY, VOICE_KEY } from '../../lib/voice/preference'
import LiveVoice from './LiveVoice'
import { installFakeSpeech } from './voiceTestKit'

const hd = vi.hoisted(() => ({
  speak: vi.fn(),
  status: { state: 'idle', progress: 0 } as { state: string; progress: number },
}))
vi.mock('../../lib/voice/hdEngine', () => ({
  hdSupported: () => true,
  watchHdStatus: () => () => {},
  getHdEngine: () => ({ kind: 'hd', speak: hd.speak, dispose: () => {}, status: () => hd.status }),
}))

let dispatch: Dispatch<DebateAction>
function Room() {
  const [state, d] = useReducer(debateReducer, initialDebateState)
  dispatch = d
  return <LiveVoice state={state} />
}

const finish = (turn_id: string, agent: 'vc' | 'cto' | 'customer' | 'competitor', text: string, round = 1) => act(() => {
  dispatch({ type: 'turn_start', data: { turn_id, agent, round, attempt: 1 } })
  dispatch({ type: 'turn_end', data: { turn_id, agent, round, text } })
})
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)))

describe('LiveVoice', () => {
  let synth: ReturnType<typeof installFakeSpeech>
  beforeEach(() => { synth = installFakeSpeech(); hd.speak.mockReset() })
  afterEach(() => vi.unstubAllGlobals())

  it('never speaks on its own, even with a remembered voice choice', async () => {
    localStorage.setItem(VOICE_KEY, 'instant')
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    await tick()
    expect(synth.speak).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'Instant' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Listen live' })).toBeInTheDocument()
  })

  it('starts on a click, remembers the choice, and speaks turns in order as they finish', async () => {
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    await userEvent.click(screen.getByRole('radio', { name: 'Instant' }))
    expect(localStorage.getItem(VOICE_KEY)).toBe('instant')
    expect(synth.current?.text).toBe('Investor opens.') // joining mid-fight starts at the newest line
    expect(screen.getByLabelText('Now speaking')).toHaveTextContent('Investor')
    expect(screen.getByLabelText('Captions')).toHaveTextContent('Investor opens.')
    finish('r1-cto', 'cto', 'Engineer replies.')
    finish('r1-customer', 'customer', 'Customer weighs in.')
    act(() => synth.end())
    await tick()
    expect(synth.current?.text).toBe('Engineer replies.')
    act(() => synth.end())
    await tick()
    expect(synth.current?.text).toBe('Customer weighs in.')
  })

  it('offers jump to live when lines queue up, and skips the backlog', async () => {
    render(<Room />)
    await userEvent.click(screen.getByRole('radio', { name: 'Instant' }))
    finish('r1-vc', 'vc', 'One.')
    await tick()
    expect(synth.current?.text).toBe('Round 1.')
    finish('r1-cto', 'cto', 'Two.')
    finish('r1-customer', 'customer', 'Three.')
    await userEvent.click(screen.getByRole('button', { name: /jump to live/i }))
    expect(synth.current?.text).toBe('Three.')
    expect(screen.queryByRole('button', { name: /jump to live/i })).not.toBeInTheDocument()
  })

  it('pauses and resumes from the controls, and turning voice off stops it', async () => {
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    await userEvent.click(screen.getByRole('radio', { name: 'Instant' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pause voice' }))
    expect(synth.current).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Listen live' }))
    expect(synth.current?.text).toBe('Investor opens.')
    await userEvent.click(screen.getByRole('radio', { name: 'Off' }))
    expect(synth.current).toBeNull()
    expect(localStorage.getItem(VOICE_KEY)).toBe('off')
  })

  it('stops speaking when the room unmounts', async () => {
    const { unmount } = render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    await userEvent.click(screen.getByRole('radio', { name: 'Instant' }))
    expect(synth.current).not.toBeNull()
    unmount()
    expect(synth.current).toBeNull()
  })

  it('works without a speech API: instant is unavailable and nothing breaks', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    render(<Room />)
    expect(screen.getByRole('radio', { name: 'Instant' })).toBeDisabled()
    expect(screen.getByText(/no built-in voices/i)).toBeInTheDocument()
  })

  it('asks before the HD download and shows its size', async () => {
    render(<Room />)
    await userEvent.click(screen.getByRole('radio', { name: 'HD' }))
    expect(screen.getByRole('group', { name: 'HD voices download' })).toHaveTextContent(/download of about 100 MB/)
    expect(hd.speak).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('group', { name: 'HD voices download' })).not.toBeInTheDocument()
    expect(localStorage.getItem(HD_CONSENT_KEY)).toBeNull()
  })

  it('falls back to the instant voices when the HD model fails to load', async () => {
    hd.speak.mockImplementation(() => ({
      done: Promise.reject(new Error('network down')), stop() {}, pause() {}, resume() {}, setRate() {},
    }))
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    await userEvent.click(screen.getByRole('radio', { name: 'HD' }))
    await userEvent.click(screen.getByRole('button', { name: /download hd voices/i }))
    expect(localStorage.getItem(HD_CONSENT_KEY)).toBe('1')
    await tick()
    await tick()
    expect(hd.speak).toHaveBeenCalledWith('Investor opens.', 'vc', 1)
    expect(synth.current?.text).toBe('Investor opens.')
    expect(screen.getByRole('status')).toHaveTextContent(/HD voices could not load/i)
    expect(screen.getByRole('radio', { name: 'Instant' })).toBeChecked()
  })
})
