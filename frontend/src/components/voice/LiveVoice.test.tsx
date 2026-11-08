import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer, type Dispatch } from 'react'
import { debateReducer, initialDebateState, type DebateAction } from '../../lib/debateReducer'
import { HD_CONSENT_KEY, SPEED_KEY, VOICE_KEY } from '../../lib/voice/preference'
import LiveVoice from './LiveVoice'
import { VoiceError } from '../../lib/voice/types'
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

  it('defaults to the instant voices and still waits for a click', async () => {
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    await tick()
    expect(screen.getByRole('radio', { name: 'Instant' })).toBeChecked()
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('arrow keys only move focus in the voice picker; Enter picks', async () => {
    localStorage.setItem(VOICE_KEY, 'off')
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    screen.getByRole('radio', { name: 'Off' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Instant' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'HD (beta)' })).toHaveFocus()
    expect(screen.queryByRole('group', { name: 'HD voices download' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Off' })).toBeChecked()
    await userEvent.keyboard('{ArrowLeft}{Enter}')
    expect(screen.getByRole('radio', { name: 'Instant' })).toBeChecked()
    expect(synth.current?.text).toBe('Investor opens.')
  })

  it('keeps order when several turns finish in the same tick', async () => {
    render(<Room />)
    await userEvent.click(screen.getByRole('radio', { name: 'Instant' }))
    act(() => {
      for (const [id, agent, text] of [['r1-vc', 'vc', 'A.'], ['r1-customer', 'customer', 'B.'], ['r1-cto', 'cto', 'C.']] as const) {
        dispatch({ type: 'turn_start', data: { turn_id: id, agent, round: 1, attempt: 1 } })
        dispatch({ type: 'turn_end', data: { turn_id: id, agent, round: 1, text } })
      }
    })
    await tick()
    const heard: string[] = []
    for (let i = 0; i < 4; i++) {
      heard.push(synth.current!.text)
      act(() => synth.end())
      await tick()
    }
    expect(heard).toEqual(['Round 1.', 'A.', 'B.', 'C.'])
  })

  it('after a reload replays the history, it starts at the newest line instead of the backlog', async () => {
    render(<Room />)
    // A reload rebuilds the room from the replayed stream before anyone presses anything.
    act(() => {
      let seq = 0
      const ev = (a: DebateAction) => dispatch({ ...a, seq: ++seq } as DebateAction)
      ev({ type: 'turn_start', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, attempt: 1 } })
      ev({ type: 'turn_end', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, text: 'Old one.' } })
      ev({ type: 'checkpoint', data: { round: 1, summary: 'Old summary', top_disagreements: ['x', 'y'] } })
      ev({ type: 'turn_start', data: { turn_id: 'r2-cto', agent: 'cto', round: 2, attempt: 1 } })
      ev({ type: 'turn_end', data: { turn_id: 'r2-cto', agent: 'cto', round: 2, text: 'Newest.' } })
      // Replayed events the reducer has already seen are dropped, so the script cannot shrink or reorder.
      dispatch({ type: 'turn_end', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, text: 'Old one.' }, seq: 2 })
    })
    await tick()
    expect(synth.speak).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Listen live' }))
    expect(synth.current?.text).toBe('Newest.')
  })

  it('starts on a click, remembers the choice, and speaks turns in order as they finish', async () => {
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    await userEvent.click(screen.getByRole('radio', { name: 'Instant' }))
    expect(localStorage.getItem(VOICE_KEY)).toBe('instant')
    expect(synth.current?.text).toBe('Investor opens.') // joining mid-fight starts at the newest line
    expect(screen.getByRole('status', { name: 'Now speaking' })).toHaveTextContent('Investor')
    expect(screen.getByRole('group', { name: 'Captions' })).toHaveTextContent('Investor opens.')
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
    await userEvent.click(screen.getByRole('radio', { name: 'HD (beta)' }))
    expect(screen.getByRole('group', { name: 'HD voices download' })).toHaveTextContent(/beta.*about 100 MB from huggingface\.co and cdn\.jsdelivr\.net.*may pause between lines/)
    expect(hd.speak).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('group', { name: 'HD voices download' })).not.toBeInTheDocument()
    expect(localStorage.getItem(HD_CONSENT_KEY)).toBeNull()
  })

  it('falls back to the instant voices when the HD model fails to load', async () => {
    hd.speak.mockImplementation(() => ({
      done: Promise.reject(new VoiceError('load', 'network down')), stop() {}, pause() {}, resume() {}, setRate() {},
    }))
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    await userEvent.click(screen.getByRole('radio', { name: 'HD (beta)' }))
    await userEvent.click(screen.getByRole('button', { name: /download hd voices/i }))
    expect(localStorage.getItem(HD_CONSENT_KEY)).toBe('1')
    await tick()
    await tick()
    expect(hd.speak).toHaveBeenCalledWith('Investor opens.', 'vc', 1)
    expect(synth.current?.text).toBe('Investor opens.')
    expect(screen.getByText(/HD voices could not load/i)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Instant' })).toBeChecked()
  })

  it('asks for a tap, without switching engines, when the browser blocks HD playback', async () => {
    localStorage.setItem(HD_CONSENT_KEY, '1')
    hd.speak.mockImplementation(() => ({
      done: Promise.reject(new VoiceError('blocked', 'tap first')), stop() {}, pause() {}, resume() {}, setRate() {},
    }))
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    await userEvent.click(screen.getByRole('radio', { name: 'HD (beta)' }))
    await tick()
    await tick()
    expect(screen.getByText(/blocked the sound\. Press play/i)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'HD (beta)' })).toBeChecked()
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('shows the speaker as getting ready while an HD line renders', async () => {
    localStorage.setItem(HD_CONSENT_KEY, '1')
    hd.speak.mockImplementation(() => ({
      done: new Promise(() => {}), started: new Promise(() => {}), stop() {}, pause() {}, resume() {}, setRate() {},
    }))
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    await userEvent.click(screen.getByRole('radio', { name: 'HD (beta)' }))
    await tick()
    expect(screen.getByRole('status', { name: 'Now speaking' })).toHaveTextContent('Investor getting ready')
  })

  it('has the same speed control, remembered and honoured live', async () => {
    localStorage.setItem(SPEED_KEY, '2')
    render(<Room />)
    finish('r1-vc', 'vc', 'Investor opens.')
    const group = screen.getByRole('radiogroup', { name: 'Speed' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['1x', '1.25x', '1.5x', '2x'])
    expect(screen.getByRole('radio', { name: '2x' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Instant' }))
    expect(synth.current!.rate).toBeCloseTo(1.05 * 2) // the investor's own rate, times 2
    await userEvent.click(screen.getByRole('radio', { name: '1.25x' }))
    expect(localStorage.getItem(SPEED_KEY)).toBe('1.25')
    finish('r1-cto', 'cto', 'Engineer replies.')
    act(() => synth.end())
    await tick()
    expect(synth.current!.text).toBe('Engineer replies.')
    expect(synth.current!.rate).toBeCloseTo(0.95 * 1.25)
  })

  it('speed arrows move focus only; Enter picks', async () => {
    render(<Room />)
    screen.getByRole('radio', { name: '1x' }).focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('radio', { name: '2x' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: '1x' })).toBeChecked()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('radio', { name: '2x' })).toBeChecked()
  })
})
