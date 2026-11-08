import { describe, expect, it, vi } from 'vitest'
import { Narrator } from './narrator'
import type { Line, SpeakHandle, VoiceEngine } from './types'

/** An engine that speaks nothing: each chunk waits until the test finishes it. */
class FakeEngine implements VoiceEngine {
  kind = 'instant' as const
  said: { text: string; voice: string; rate: number; handle: SpeakHandle & { finish(): void; fail(e: Error): void; paused: boolean; stopped: boolean } }[] = []
  prepared: string[] = []
  speak(text: string, voice: Line['voice'], rate: number) {
    let finish!: () => void
    let fail!: (e: Error) => void
    const done = new Promise<void>((res, rej) => { finish = res; fail = rej })
    const handle = {
      done, finish, fail, paused: false, stopped: false,
      stop() { handle.stopped = true },
      pause() { handle.paused = true },
      resume() { handle.paused = false },
      setRate: vi.fn(),
    }
    this.said.push({ text, voice, rate, handle })
    return handle
  }
  prepare(text: string) { this.prepared.push(text) }
  dispose() {}
  get last() { return this.said.at(-1)! }
}

const line = (key: string, text: string, voice: Line['voice'] = 'vc'): Line => ({ key, voice, who: key, text })
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function finishLast(e: FakeEngine) {
  e.last.handle.finish()
  await flush()
}

describe('Narrator', () => {
  it('does nothing until play is called', () => {
    const e = new FakeEngine()
    const n = new Narrator({ live: false })
    n.setEngine(e)
    n.setLines([line('a', 'One.')])
    expect(e.said).toHaveLength(0)
    expect(n.getSnapshot().status).toBe('idle')
  })

  it('speaks lines in order, chunk by chunk, and ends', async () => {
    const e = new FakeEngine()
    const n = new Narrator({ live: false })
    n.setEngine(e)
    n.setLines([line('a', 'One.'), line('b', 'Two.', 'cto')])
    n.play()
    expect(e.last.text).toBe('One.')
    expect(e.prepared).toContain('Two.') // the next line is warmed while this one plays
    await finishLast(e)
    expect(e.last).toMatchObject({ text: 'Two.', voice: 'cto' })
    await finishLast(e)
    expect(n.getSnapshot().status).toBe('ended')
    expect(e.said.map((s) => s.text)).toEqual(['One.', 'Two.'])
  })

  it('in live mode waits for more lines, then carries on with them in order', async () => {
    const e = new FakeEngine()
    const n = new Narrator({ live: true })
    n.setEngine(e)
    n.setLines([line('a', 'One.')])
    n.play()
    await finishLast(e)
    expect(n.getSnapshot().status).toBe('waiting')
    n.setLines([line('a', 'One.'), line('b', 'Two.'), line('c', 'Three.')])
    expect(e.last.text).toBe('Two.')
    await finishLast(e)
    expect(e.last.text).toBe('Three.')
  })

  it('jump to live skips the backlog and plays the newest line', async () => {
    const e = new FakeEngine()
    const n = new Narrator({ live: true })
    n.setEngine(e)
    n.setLines([line('a', 'One.'), line('b', 'Two.'), line('c', 'Three.'), line('d', 'Four.')])
    n.play()
    const first = e.last.handle
    n.jumpToLive()
    expect(first.stopped).toBe(true)
    expect(e.last.text).toBe('Four.')
    expect(n.getSnapshot().index).toBe(3)
    first.finish() // a late end from the stopped line must not advance anything
    await flush()
    expect(e.said.map((s) => s.text)).toEqual(['One.', 'Four.'])
  })

  it('pauses and resumes the same chunk without restarting it', async () => {
    const e = new FakeEngine()
    const n = new Narrator({ live: false })
    n.setEngine(e)
    n.setLines([line('a', 'One.'), line('b', 'Two.')])
    n.play()
    n.pause()
    expect(e.last.handle.paused).toBe(true)
    expect(n.getSnapshot().status).toBe('paused')
    n.resume()
    expect(e.last.handle.paused).toBe(false)
    expect(e.said).toHaveLength(1)
    expect(n.getSnapshot().status).toBe('playing')
  })

  it('moves to the previous and next line', () => {
    const e = new FakeEngine()
    const n = new Narrator({ live: false })
    n.setEngine(e)
    n.setLines([line('a', 'One.'), line('b', 'Two.'), line('c', 'Three.')])
    n.play()
    n.next()
    n.next()
    expect(e.last.text).toBe('Three.')
    n.prev()
    expect(e.last.text).toBe('Two.')
    n.prev()
    n.prev()
    expect(e.last.text).toBe('One.')
    expect(n.getSnapshot().index).toBe(0)
  })

  it('applies a speed change to the chunk in progress and to later ones', async () => {
    const e = new FakeEngine()
    const n = new Narrator({ live: false })
    n.setEngine(e)
    n.setLines([line('a', 'One.'), line('b', 'Two.')])
    n.play()
    n.setRate(1.5)
    expect(e.last.handle.setRate).toHaveBeenCalledWith(1.5)
    await finishLast(e)
    expect(e.last.rate).toBe(1.5)
    expect(n.getSnapshot().rate).toBe(1.5)
  })

  it('reports an engine failure and can carry on from the same chunk on another engine', async () => {
    const onEngineError = vi.fn()
    const bad = new FakeEngine()
    const good = new FakeEngine()
    const n = new Narrator({ live: false, onEngineError })
    n.setEngine(bad)
    n.setLines([line('a', 'One.'), line('b', 'Two.')])
    n.play()
    bad.last.handle.fail(new Error('model did not load'))
    await flush()
    expect(onEngineError).toHaveBeenCalledWith(expect.objectContaining({ message: 'model did not load' }))
    n.setEngine(good)
    n.play()
    expect(good.last.text).toBe('One.')
  })

  it('stops speaking for good on dispose', async () => {
    const e = new FakeEngine()
    const n = new Narrator({ live: false })
    n.setEngine(e)
    n.setLines([line('a', 'One.'), line('b', 'Two.')])
    n.play()
    const h = e.last.handle
    n.dispose()
    expect(h.stopped).toBe(true)
    h.finish()
    await flush()
    expect(e.said).toHaveLength(1)
    expect(n.getSnapshot().status).toBe('idle')
  })
})
