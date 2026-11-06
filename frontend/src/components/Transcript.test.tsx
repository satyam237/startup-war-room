import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
