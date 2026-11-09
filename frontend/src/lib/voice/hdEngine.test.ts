import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE_MS, createHdEngine, type AudioLike, type HdStatus, type WorkerLike } from './hdEngine'
import { KOKORO_VOICE } from './cast'

type Sent = { type: string; id?: number; text?: string; voice?: string }

class FakeWorker implements WorkerLike {
  sent: Sent[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  postMessage(msg: Sent) { this.sent.push(msg) }
  terminate() { this.terminated = true }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent) }
  get speaks() { return this.sent.filter((m) => m.type === 'speak') }
}

class FakeAudio implements AudioLike {
  playbackRate = 1
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  playing = false
  released = false
  playResult: Promise<void> = Promise.resolve()
  constructor(public wav: ArrayBuffer) {}
  play() { this.playing = true; return this.playResult }
  pause() { this.playing = false }
  release() { this.released = true }
}

/** Lets promise chains settle without relying on timers, so fake timers can be used too. */
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function setup(opts: { playError?: Error } = {}) {
  const workers: FakeWorker[] = []
  const audios: FakeAudio[] = []
  const statuses: HdStatus[] = []
  const engine = createHdEngine({
    makeWorker: () => { const w = new FakeWorker(); workers.push(w); return w },
    makeAudio: (wav) => {
      const a = new FakeAudio(wav)
      if (opts.playError) a.playResult = Promise.reject(opts.playError)
      audios.push(a)
      return a
    },
    onStatus: (s) => statuses.push(s),
  })
  return { workers, get worker() { return workers.at(-1)! }, audios, statuses, engine }
}

async function ready(w: FakeWorker) {
  await flush()
  w.reply({ type: 'ready', device: 'wasm' })
  await flush()
}

describe('HD engine', () => {
  afterEach(() => vi.useRealTimers())

  it('creates no worker and downloads nothing until it is first asked to speak', () => {
    const makeWorker = vi.fn()
    createHdEngine({ makeWorker, makeAudio: () => new FakeAudio(new ArrayBuffer(0)) })
    expect(makeWorker).not.toHaveBeenCalled()
  })

  it('loads the model once, shows progress, then plays the generated audio in the cast voice', async () => {
    const t = setup()
    const h = t.engine.speak('Hello.', 'cto', 1.25)
    let started = false
    void h.started!.then(() => { started = true })
    await flush()
    expect(t.worker.sent[0]).toEqual({ type: 'load' })
    t.worker.reply({ type: 'progress', loaded: 46, total: 92 })
    await ready(t.worker)
    expect(t.statuses.map((s) => s.state)).toEqual(['loading', 'loading', 'ready'])
    expect(t.statuses[1].progress).toBeCloseTo(0.5)
    const gen = t.worker.speaks[0]
    expect(gen).toMatchObject({ text: 'Hello.', voice: KOKORO_VOICE.cto, speed: 1.25 }) // Kokoro renders at the speed
    expect(started).toBe(false) // still rendering: the UI shows loading, not speaking
    t.worker.reply({ type: 'audio', id: gen.id, wav: new ArrayBuffer(8) })
    await flush()
    expect(t.audios[0].playing).toBe(true)
    expect(t.audios[0].playbackRate).toBe(1) // already at speed; no time-stretching needed
    expect(started).toBe(true)
    let ended = false
    void h.done.then(() => { ended = true })
    t.audios[0].onended?.()
    await flush()
    expect(ended).toBe(true)
    expect(t.audios[0].released).toBe(true)

    t.engine.speak('Again.', 'vc', 1)
    await flush()
    expect(t.workers).toHaveLength(1)
    expect(t.worker.sent.filter((m) => m.type === 'load')).toHaveLength(1)
  })

  it('renders a prepared chunk ahead of time and does not render it twice', async () => {
    const t = setup()
    t.engine.prepare!('Later.', 'vc')
    await ready(t.worker)
    t.engine.speak('Later.', 'vc', 1)
    await flush()
    expect(t.worker.speaks).toHaveLength(1)
  })

  it('after five quick skips, tells the worker to drop stale renders and plays only the wanted chunk', async () => {
    const t = setup()
    await (async () => { t.engine.speak('warm up', 'vc', 1); await ready(t.worker) })()
    for (const n of [1, 2, 3, 4, 5]) {
      t.engine.cancel!() // the narrator cancels on every skip
      t.engine.speak(`Skipped ${n}.`, 'vc', 1)
      t.engine.prepare!(`Ahead of ${n}.`, 'vc')
      await flush()
    }
    t.engine.cancel!()
    t.engine.speak('Wanted.', 'cto', 1)
    await flush()
    const last = t.worker.sent.at(-1)!
    expect(last).toMatchObject({ type: 'speak', text: 'Wanted.' })
    expect(t.worker.sent.at(-2)).toEqual({ type: 'cancel' })
    // Late replies for the dropped renders are ignored; only the wanted one plays.
    for (const m of t.worker.speaks.slice(0, -1)) t.worker.reply({ type: 'audio', id: m.id, wav: new ArrayBuffer(4) })
    await flush()
    expect(t.audios).toHaveLength(0)
    t.worker.reply({ type: 'audio', id: last.id, wav: new ArrayBuffer(8) })
    await flush()
    expect(t.audios).toHaveLength(1)
    expect(t.audios[0].wav.byteLength).toBe(8)
  })

  it('cancel clears render-ahead, so a dropped chunk is rendered again when it is wanted', async () => {
    const t = setup()
    t.engine.prepare!('Maybe.', 'vc')
    await ready(t.worker)
    t.engine.cancel!()
    t.engine.speak('Maybe.', 'vc', 1)
    await flush()
    expect(t.worker.speaks.map((m) => m.text)).toEqual(['Maybe.', 'Maybe.'])
  })

  it('stopping mid-render plays nothing and settles at once', async () => {
    const t = setup()
    const h = t.engine.speak('Never heard.', 'vc', 1)
    await ready(t.worker)
    h.stop()
    t.engine.cancel!()
    await expect(h.done).resolves.toBeUndefined()
    t.worker.reply({ type: 'audio', id: t.worker.speaks[0].id, wav: new ArrayBuffer(8) })
    await flush()
    expect(t.audios).toHaveLength(0)
  })

  it('pauses, resumes and changes speed on the playing audio', async () => {
    const t = setup()
    const h = t.engine.speak('Hi.', 'vc', 1)
    await ready(t.worker)
    t.worker.reply({ type: 'audio', id: t.worker.speaks[0].id, wav: new ArrayBuffer(8) })
    await flush()
    h.pause()
    expect(t.audios[0].playing).toBe(false)
    h.resume()
    expect(t.audios[0].playing).toBe(true)
    h.setRate(1.5) // rendered at 1x, so the element makes up the difference at once, pitch preserved
    expect(t.audios[0].playbackRate).toBe(1.5)
    h.stop()
    expect(t.audios[0].playing).toBe(false)
    expect(t.audios[0].released).toBe(true)
  })

  it('a failed load rejects as a load error, reports it, and lets a later attempt start over', async () => {
    const t = setup()
    const h = t.engine.speak('Hi.', 'vc', 1)
    await flush()
    t.worker.reply({ type: 'load-error', message: 'no network' })
    await expect(h.done).rejects.toMatchObject({ kind: 'load', message: 'no network' })
    expect(t.statuses.at(-1)).toMatchObject({ state: 'failed', error: 'no network' })
    expect(t.worker.terminated).toBe(true)
    t.engine.speak('Hi.', 'vc', 1)
    await flush()
    expect(t.workers).toHaveLength(2)
  })

  it('a single failed render rejects as a chunk error and keeps the model', async () => {
    const t = setup()
    const h = t.engine.speak('Odd text.', 'vc', 1)
    await ready(t.worker)
    t.worker.reply({ type: 'speak-error', id: t.worker.speaks[0].id, message: 'bad phonemes' })
    await expect(h.done).rejects.toMatchObject({ kind: 'chunk' })
    expect(t.worker.terminated).toBe(false)
  })

  it("asks for a tap when the browser blocks play() (Safari's NotAllowedError)", async () => {
    const blocked = Object.assign(new Error('play() needs a user gesture'), { name: 'NotAllowedError' })
    const t = setup({ playError: blocked })
    const h = t.engine.speak('Hi.', 'vc', 1)
    await ready(t.worker)
    t.worker.reply({ type: 'audio', id: t.worker.speaks[0].id, wav: new ArrayBuffer(8) })
    await expect(h.done).rejects.toMatchObject({ kind: 'blocked' })
  })

  it('lets the worker and model go after two idle minutes, and starts again on the next use', async () => {
    vi.useFakeTimers()
    const t = setup()
    const h = t.engine.speak('Hi.', 'vc', 1)
    await ready(t.worker)
    t.worker.reply({ type: 'audio', id: t.worker.speaks[0].id, wav: new ArrayBuffer(8) })
    await flush()
    vi.advanceTimersByTime(IDLE_MS + 1000)
    expect(t.worker.terminated).toBe(false) // still talking
    t.audios[0].onended?.()
    await h.done
    vi.advanceTimersByTime(IDLE_MS - 1000)
    expect(t.worker.terminated).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(t.worker.terminated).toBe(true)
    expect(t.statuses.at(-1)?.state).toBe('idle')
    t.engine.speak('Back.', 'vc', 1)
    await flush()
    expect(t.workers).toHaveLength(2)
  })

  it('lets go soon after the listener leaves the voice pages', async () => {
    vi.useFakeTimers()
    const t = setup()
    t.engine.prepare!('Hi.', 'vc')
    await ready(t.worker)
    const h = t.engine.speak('Hi.', 'vc', 1)
    await flush()
    t.engine.releaseSoon(5000)
    // The page's own stop on unmount (the narrator stops the chunk and cancels its renders) comes after,
    // and must not push the release back two minutes.
    h.stop()
    t.engine.cancel!()
    vi.advanceTimersByTime(5001)
    expect(t.worker.terminated).toBe(true)
  })

  it('a skip during a slow model load never posts the cancelled renders', async () => {
    const t = setup()
    t.engine.speak('Old line.', 'vc', 1)
    t.engine.prepare!('Old ahead 1.', 'vc')
    t.engine.prepare!('Old ahead 2.', 'vc')
    await flush()
    t.engine.cancel!() // the listener skips while the model is still loading
    t.engine.speak('Wanted.', 'cto', 1)
    await ready(t.worker) // the load finishes only now
    expect(t.worker.speaks.map((m) => m.text)).toEqual(['Wanted.'])
  })

  it('does not let the worker go while a render outlives the idle time', async () => {
    vi.useFakeTimers()
    const t = setup()
    const h = t.engine.speak('A very long render.', 'vc', 1)
    await ready(t.worker)
    vi.advanceTimersByTime(IDLE_MS * 2 + 1000)
    expect(t.worker.terminated).toBe(false)
    t.worker.reply({ type: 'audio', id: t.worker.speaks[0].id, wav: new ArrayBuffer(8) })
    await flush()
    expect(t.audios).toHaveLength(1)
    t.audios[0].onended?.()
    await h.done
    vi.advanceTimersByTime(IDLE_MS + 1)
    expect(t.worker.terminated).toBe(true)
  })

  it('a mid-line speed change applies at once to the playing chunk and to render-ahead after it', async () => {
    const t = setup()
    const h = t.engine.speak('Now.', 'vc', 1)
    t.engine.prepare!('Soon.', 'vc') // rendered ahead at 1x
    await ready(t.worker)
    t.worker.reply({ type: 'audio', id: t.worker.speaks[0].id, wav: new ArrayBuffer(8) })
    await flush()
    h.setRate(2)
    expect(t.audios[0].playbackRate).toBe(2)
    t.engine.prepare!('Later.', 'vc')
    await flush()
    expect(t.worker.speaks.map((m) => [m.text, (m as { speed?: number }).speed])).toEqual([['Now.', 1], ['Soon.', 1], ['Later.', 2]])
    // The chunk rendered ahead at 1x plays at 2x through the element, without a second render.
    t.audios[0].onended?.()
    await h.done
    t.engine.speak('Soon.', 'vc', 2)
    t.worker.reply({ type: 'audio', id: t.worker.speaks[1].id, wav: new ArrayBuffer(8) })
    await flush()
    expect(t.worker.speaks).toHaveLength(3)
    expect(t.audios[1].playbackRate).toBe(2)
  })
})
