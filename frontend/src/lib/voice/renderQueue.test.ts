import { describe, expect, it } from 'vitest'
import { RenderQueue } from './renderQueue'

describe('RenderQueue (the HD worker side)', () => {
  it('renders one job at a time, in order', async () => {
    const order: string[] = []
    const q = new RenderQueue<string>(async (j) => { order.push(j) })
    q.push('a'); q.push('b'); q.push('c')
    await new Promise((r) => setTimeout(r, 0))
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('after five quick skips, the wanted line renders next', async () => {
    const order: string[] = []
    let finishFirst!: () => void
    const q = new RenderQueue<string>((j) => {
      order.push(j)
      return j === 'playing' ? new Promise<void>((r) => { finishFirst = r }) : Promise.resolve()
    })
    q.push('playing') // already rendering; cannot be interrupted
    for (const n of [1, 2, 3, 4, 5]) {
      q.cancelAll()
      q.push(`skipped ${n}`)
      q.push(`ahead of ${n}`)
    }
    q.cancelAll()
    q.push('wanted')
    expect(q.waiting).toBe(1)
    finishFirst()
    await new Promise((r) => setTimeout(r, 0))
    expect(order).toEqual(['playing', 'wanted'])
  })
})
