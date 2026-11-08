import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DebateRecord } from '../../lib/api'
import { SPEED_KEY, VOICE_KEY } from '../../lib/voice/preference'
import BroadcastReplay from './BroadcastReplay'
import { installFakeSpeech } from './voiceTestKit'

vi.mock('../../lib/voice/hdEngine', () => ({
  hdSupported: () => true,
  watchHdStatus: () => () => {},
  getHdEngine: () => { throw new Error('not used here') },
}))

const debate: DebateRecord = {
  id: 'abc',
  pitch: 'Electricians on demand.',
  status: 'complete',
  rebuttal: 'We have 40 signed.',
  verdict: {
    recommendation: 'go', confidence: 0.8,
    scorecard: {
      market: { score: 8, why: '' }, customer_pull: { score: 6, why: '' }, feasibility: { score: 7, why: '' },
      defensibility: { score: 3, why: '' }, timing: { score: 5, why: '' },
    },
    risks: [], experiments: [], one_line_summary: 'Ship it.', fallback: false,
  },
  turns: [
    { id: 1, round: 1, agent: 'vc', text: 'VC speaks.' },
    { id: 2, round: 1, agent: 'moderator', text: 'Summary.', details: { top_disagreements: ['A', 'B'] } },
    { id: 3, round: 2, agent: 'cto', text: 'CTO speaks.' },
  ],
}
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)))

describe('BroadcastReplay', () => {
  let synth: ReturnType<typeof installFakeSpeech>
  beforeEach(() => { synth = installFakeSpeech() })
  afterEach(() => vi.unstubAllGlobals())

  it('lists every line as a caption and makes no sound until play is pressed', () => {
    render(<BroadcastReplay debate={debate} />)
    const captions = within(screen.getByRole('list', { name: 'Broadcast captions' })).getAllByRole('listitem')
    expect(captions).toHaveLength(8)
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('plays the debate in order from the intro, highlighting the current caption', async () => {
    render(<BroadcastReplay debate={debate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Play broadcast' }))
    expect(screen.getByRole('radio', { name: 'Instant' })).toBeChecked() // instant is the default
    const heard: string[] = []
    for (let i = 0; i < 30 && synth.current; i++) {
      heard.push(synth.current.text)
      act(() => synth.end())
      await tick()
    }
    expect(heard.join(' ')).toBe([
      "Startup War Room. Tonight's pitch. Electricians on demand.",
      'Round 1.',
      'VC speaks.',
      'End of round 1. Summary. The top disagreements. A. B.',
      'We have 40 signed.',
      'Round 2.',
      'CTO speaks.',
      'The verdict. Go. Confidence 80 percent. Ship it.',
    ].join(' '))
    expect(screen.getByRole('button', { name: 'Play broadcast' })).toBeInTheDocument() // ended: offers to play again
  })

  it('steps to the next and previous line and marks it current', async () => {
    render(<BroadcastReplay debate={debate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Play broadcast' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next line' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next line' }))
    expect(synth.current?.text).toBe('VC speaks.')
    const current = screen.getByRole('list', { name: 'Broadcast captions' }).querySelector('[aria-current="true"]')
    expect(current).toHaveTextContent('VC speaks.')
    await userEvent.click(screen.getByRole('button', { name: 'Previous line' }))
    expect(synth.current?.text).toBe('Round 1.')
  })

  it('jumps to a line from its caption', async () => {
    render(<BroadcastReplay debate={debate} />)
    await userEvent.click(screen.getByRole('button', { name: /play from here:\s*founder/i }))
    expect(synth.current?.text).toBe('We have 40 signed.')
  })

  it('offers 1x to 2x; a change keeps the current chunk going and speeds up the next one, and is remembered', async () => {
    render(<BroadcastReplay debate={debate} />)
    const group = screen.getByRole('radiogroup', { name: 'Speed' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['1x', '1.25x', '1.5x', '2x'])
    await userEvent.click(screen.getByRole('button', { name: 'Play broadcast' }))
    const first = synth.current!
    await userEvent.click(screen.getByRole('radio', { name: '2x' }))
    expect(synth.current).toBe(first) // not restarted
    expect(screen.getByRole('radio', { name: '2x' })).toBeChecked()
    expect(localStorage.getItem(SPEED_KEY)).toBe('2')
    act(() => synth.end())
    await tick()
    expect(synth.current!.rate).toBeCloseTo(first.rate * 2)
  })

  it('plays at the remembered speed', async () => {
    localStorage.setItem(SPEED_KEY, '1.5')
    render(<BroadcastReplay debate={debate} />)
    expect(screen.getByRole('radio', { name: '1.5x' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Play broadcast' }))
    expect(synth.current!.rate).toBeCloseTo(0.95 * 1.5) // the announcer's own rate, times the speed
  })

  it('pauses and resumes', async () => {
    render(<BroadcastReplay debate={debate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Play broadcast' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pause broadcast' }))
    expect(synth.current).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Resume broadcast' }))
    expect(synth.current?.text).toBe('Startup War Room.') // the same first chunk, said again
  })

  it('a turned-off voice is switched to instant by pressing play', async () => {
    localStorage.setItem(VOICE_KEY, 'off')
    render(<BroadcastReplay debate={debate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Play broadcast' }))
    expect(localStorage.getItem(VOICE_KEY)).toBe('instant')
    expect(synth.current?.text).toMatch(/^Startup War Room/)
  })

  it('next on the last line does nothing', async () => {
    render(<BroadcastReplay debate={debate} />)
    await userEvent.click(screen.getByRole('button', { name: /play from here:\s*moderator.*the verdict/i }))
    const last = synth.current
    await userEvent.click(screen.getByRole('button', { name: 'Next line' }))
    expect(synth.current).toBe(last)
  })

  it('stops on unmount', async () => {
    const { unmount } = render(<BroadcastReplay debate={debate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Play broadcast' }))
    unmount()
    expect(synth.current).toBeNull()
  })
})
