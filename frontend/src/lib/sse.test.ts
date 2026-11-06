import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDebate } from './sse'
import type { DebateAction } from './debateReducer'

class FakeES {
  static last: FakeES
  listeners: Record<string, ((e: unknown) => void)[]> = {}
  closed = false
  constructor(public url: string) { FakeES.last = this }
  addEventListener(n: string, f: (e: unknown) => void) { (this.listeners[n] ??= []).push(f) }
  close() { this.closed = true }
  emit(n: string, e: unknown) { this.listeners[n]?.forEach((f) => f(e)) }
}

describe('connectDebate', () => {
  beforeEach(() => vi.stubGlobal('EventSource', FakeES))
  afterEach(() => vi.unstubAllGlobals())

  it('dispatches with seq from lastEventId and closes on done', () => {
    const got: DebateAction[] = []
    connectDebate('abc', (a) => got.push(a))
    expect(FakeES.last.url).toBe('/debates/abc/stream')
    FakeES.last.emit('turn_token', { data: '{"turn_id":"t","text":"hi"}', lastEventId: '7' })
    expect(got).toEqual([{ type: 'turn_token', data: { turn_id: 't', text: 'hi' }, seq: 7 }])
    expect(FakeES.last.closed).toBe(false)
    FakeES.last.emit('done', { data: '{"status":"complete"}', lastEventId: '8' })
    expect(got).toHaveLength(2)
    expect(FakeES.last.closed).toBe(true)
  })

  it('ignores the data-less transport error event but keeps the stream open', () => {
    const got: DebateAction[] = []
    connectDebate('abc', (a) => got.push(a))
    FakeES.last.emit('error', new Event('error'))
    expect(got).toEqual([])
    expect(FakeES.last.closed).toBe(false)
    FakeES.last.emit('error', { data: '{"message":"bad","recoverable":false}', lastEventId: '9' })
    expect(got).toEqual([{ type: 'error', data: { message: 'bad', recoverable: false }, seq: 9 }])
  })

  it('returned cleanup closes the stream', () => {
    const close = connectDebate('abc', () => {})
    close()
    expect(FakeES.last.closed).toBe(true)
  })
})
