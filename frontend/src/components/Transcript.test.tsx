import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Transcript from './Transcript'
import { debateReducer, initialDebateState, type DebateAction } from '../lib/debateReducer'

const run = (actions: DebateAction[]) => actions.reduce(debateReducer, initialDebateState)

describe('Transcript', () => {
  it('shows the failure note, not an empty card, for a turn that was reset and then failed', () => {
    const state = run([
      { type: 'turn_start', data: { turn_id: 'r1-cto', agent: 'cto', round: 1, attempt: 1 } },
      { type: 'turn_token', data: { turn_id: 'r1-cto', text: 'Half a thought' } },
      { type: 'turn_reset', data: { turn_id: 'r1-cto', reason: 'failed' } },
      { type: 'turn_failed', data: { agent: 'cto', round: 1, note: 'The engineer could not answer this round.' } },
    ])
    render(<Transcript state={state} />)
    expect(screen.getByText('The engineer could not answer this round.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  it('renders two identical disagreements without a duplicate-key warning', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const state = run([
      { type: 'checkpoint', data: { round: 1, summary: 'Round one.', top_disagreements: ['Same point', 'Same point'] } },
    ])
    render(<Transcript state={state} />)
    expect(screen.getAllByText('Same point')).toHaveLength(2)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('still shows a turn that is streaming but has no text yet', () => {
    const state = run([{ type: 'turn_start', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, attempt: 1 } }])
    render(<Transcript state={state} />)
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument()
  })

  it('renders turns, failures and checkpoints in arrival order', () => {
    const state = run([
      { type: 'turn_end', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, text: 'first turn' } },
      { type: 'turn_failed', data: { agent: 'customer', round: 1, note: 'second, a failure' } },
      { type: 'checkpoint', data: { round: 1, summary: 'third, a checkpoint', top_disagreements: ['a', 'b'] } },
      { type: 'turn_end', data: { turn_id: 'r2-vc', agent: 'vc', round: 2, text: 'fourth turn' } },
      { type: 'turn_failed', data: { agent: 'moderator', round: 2, note: 'fifth, a failure' } },
    ])
    render(<Transcript state={state} />)
    const feed = screen.getByRole('log').textContent ?? ''
    const places = ['first turn', 'second, a failure', 'third, a checkpoint', 'fourth turn', 'fifth, a failure']
      .map((text) => feed.indexOf(text))
    expect(places.every((p) => p >= 0)).toBe(true)
    expect(places).toEqual([...places].sort((a, b) => a - b))
  })

  it('keeps a retried turn in its first place in the feed', () => {
    const state = run([
      { type: 'turn_start', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, attempt: 1 } },
      { type: 'turn_failed', data: { agent: 'moderator', round: 1, note: 'a note' } },
      { type: 'turn_start', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, attempt: 2 } },
    ])
    expect(state.feed).toEqual([{ kind: 'turn', id: 'r1-vc' }, { kind: 'failure', agent: 'moderator', round: 1, note: 'a note' }])
  })

  it('stops following when the reader scrolls up, and Jump to latest resumes it', () => {
    const start: DebateAction = { type: 'turn_start', data: { turn_id: 'r1-vc', agent: 'vc', round: 1, attempt: 1 } }
    const token = (text: string): DebateAction => ({ type: 'turn_token', data: { turn_id: 'r1-vc', text } })
    const first = run([start, token('one')])
    const { rerender } = render(<Transcript state={first} />)
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })

    log.scrollTop = 100 // far from the bottom
    fireEvent.scroll(log)
    const button = screen.getByRole('button', { name: /jump to latest/i })

    const second = debateReducer(first, token(' two'))
    rerender(<Transcript state={second} />)
    expect(log.scrollTop).toBe(100) // new text did not pull the reader down

    fireEvent.click(button)
    expect(log.scrollTop).toBe(1000)
    expect(screen.queryByRole('button', { name: /jump to latest/i })).not.toBeInTheDocument()

    rerender(<Transcript state={debateReducer(second, token(' three'))} />)
    expect(log.scrollTop).toBe(1000) // following again
  })
})
