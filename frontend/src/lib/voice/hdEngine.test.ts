import { describe, expect, it, vi } from 'vitest'
import { createHdEngine, type AudioLike, type HdStatus, type WorkerLike } from './hdEngine'
import { KOKORO_VOICE } from './cast'

class FakeWorker implements WorkerLike {
  sent: { type: string; id?: number; text?: string; voice?: string }[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  postMessage(msg: { type: string }) { this.sent.push(msg) }
  terminate() { this.terminated = true }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent) }
}

class FakeAudio implements AudioLike {
  playbackRate = 1
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  playing = false
  released = false
  constructor(public wav: ArrayBuffer) {}
  play() { this.playing = true; return Promise.resolve() }
  pause() { this.playing = false }
  release() { this.released = true }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function setup() {
  const worker = new FakeWorker()
  const audios: FakeAudio[] = []
  const statuses: HdStatus[] = []
  const engine = createHdEngine({
    makeWorker: () => worker,
    makeAudio: (wav) => { const a = new FakeAudio(wav); audios.push(a); return a },
    onStatus: (s) => statuses.push(s),
  })
  return { worker, audios, statuses, engine }
}

describe('HD engine', () => {
  it('creates no worker and downloads nothing until it is first asked to speak', () => {
    const makeWorker = vi.fn()
    createHdEngine({ makeWorker, makeAudio: () => new FakeAudio(new ArrayBuffer(0)) })
    expect(makeWorker).not.toHaveBeenCalled()
  })

  it('loads the model once, shows progress, then plays the generated audio in the cast voice', async () => {
    const { worker, audios, statuses, engine } = setup()
    const h = engine.speak('Hello.', 'cto', 1.25)
    await flush()
    expect(worker.sent[0]).toEqual({ type: 'load' })
    worker.reply({ type: 'progress', loaded: 46, total: 92 })
    worker.reply({ type: 'ready', device: 'wasm' })
    await flush()
    expect(statuses.map((s) => s.state)).toEqual(['loading', 'loading', 'ready'])
    expect(statuses[1].progress).toBeCloseTo(0.5)
    const gen = worker.sent.find((m) => m.type === 'speak')!
    expect(gen).toMatchObject({ text: 'Hello.', voice: KOKORO_VOICE.cto })
    worker.reply({ type: 'audio', id: gen.id, wav: new ArrayBuffer(8) })
    await flush()
    expect(audios).toHaveLength(1)
    expect(audios[0].playing).toBe(true)
    expect(audios[0].playbackRate).toBe(1.25)
    let ended = false
    void h.done.then(() => { ended = true })
    audios[0].onended?.()
    await flush()
    expect(ended).toBe(true)
    expect(audios[0].released).toBe(true)

    engine.speak('Again.', 'vc', 1)
    await flush()
    expect(worker.sent.filter((m) => m.type === 'load')).toHaveLength(1)
  })

  it('generates a prepared chunk ahead of time and does not generate it twice', async () => {
    const { worker, engine } = setup()
    engine.prepare!('Later.', 'vc')
    await flush()
    worker.reply({ type: 'ready', device: 'wasm' })
    await flush()
    engine.speak('Later.', 'vc', 1)
    await flush()
    expect(worker.sent.filter((m) => m.type === 'speak')).toHaveLength(1)
  })

  it('pauses, resumes and changes speed on the playing audio', async () => {
    const { worker, audios, engine } = setup()
    const h = engine.speak('Hi.', 'vc', 1)
    await flush()
    worker.reply({ type: 'ready', device: 'webgpu' })
    await flush()
    worker.reply({ type: 'audio', id: worker.sent.at(-1)!.id, wav: new ArrayBuffer(8) })
    await flush()
    h.pause()
    expect(audios[0].playing).toBe(false)
    h.resume()
    expect(audios[0].playing).toBe(true)
    h.setRate(1.5)
    expect(audios[0].playbackRate).toBe(1.5)
    h.stop()
    expect(audios[0].playing).toBe(false)
    expect(audios[0].released).toBe(true)
  })

  it('rejects, reports the failure, and lets a later attempt retry when the model fails to load', async () => {
    const { worker, statuses, engine } = setup()
    const h = engine.speak('Hi.', 'vc', 1)
    await flush()
    worker.reply({ type: 'load-error', message: 'no network' })
    await expect(h.done).rejects.toThrow('no network')
    expect(statuses.at(-1)).toMatchObject({ state: 'failed', error: 'no network' })
    expect(worker.terminated).toBe(true)
  })
})
