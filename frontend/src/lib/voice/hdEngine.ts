/**
 * HD voices: Kokoro-82M running in a Web Worker (kokoro.worker.ts), so rendering never blocks the page.
 * Nothing loads until the first chunk is requested. The browser caches the model files, so a later load
 * skips the download. The worker and model are let go after two idle minutes, or a few seconds after the
 * listener leaves the voice pages, and come back on the next use.
 */
import { KOKORO_VOICE } from './cast'
import { VoiceError, type SpeakHandle, type VoiceEngine, type VoiceRole } from './types'
import { watchVoicePages } from './voicePresence'

export interface HdStatus {
  state: 'idle' | 'loading' | 'ready' | 'failed'
  /** 0 to 1 while loading. */
  progress: number
  device?: string
  error?: string
}

export interface WorkerLike {
  postMessage(msg: unknown): void
  terminate(): void
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
}

export interface AudioLike {
  playbackRate: number
  onended: (() => void) | null
  onerror: (() => void) | null
  play(): Promise<void>
  pause(): void
  /** Frees the audio data. */
  release(): void
}

/** Messages from the worker. */
export type WorkerReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: string }
  | { type: 'load-error'; message: string }
  | { type: 'audio'; id: number; wav: ArrayBuffer }
  | { type: 'speak-error'; id: number; message: string }

interface Deps {
  makeWorker: () => WorkerLike
  makeAudio: (wav: ArrayBuffer) => AudioLike
  onStatus?: (s: HdStatus) => void
  /** Let the worker go after this long with nothing playing. */
  idleMs?: number
}

export const IDLE_MS = 120_000
/** Grace after the last voice page closes, so moving from the room to the verdict keeps the model. */
export const LEAVE_MS = 5_000

export type HdEngine = VoiceEngine & {
  status(): HdStatus
  /** Lets the worker go after `ms` unless it is used again. */
  releaseSoon(ms: number): void
  /** Lets the worker and model go now. */
  release(): void
}

const cancelled = () => new VoiceError('chunk', 'cancelled')

export function createHdEngine({ makeWorker, makeAudio, onStatus, idleMs = IDLE_MS }: Deps): HdEngine {
  let worker: WorkerLike | null = null
  let status: HdStatus = { state: 'idle', progress: 0 }
  let loading: Promise<void> | null = null
  let settleLoad: { resolve(): void; reject(e: Error): void } | null = null
  let nextId = 1
  const pending = new Map<number, { resolve(wav: ArrayBuffer): void; reject(e: Error): void }>()
  /** Renders asked for and not yet played: the chunk in hand plus the render-ahead. */
  const rendered = new Map<string, Promise<ArrayBuffer>>()
  let active: { stop(): void; sounding(): boolean } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Set once the listener has left the voice pages; a stop that follows must not push the release back. */
  let leaving = false

  const report = (s: HdStatus) => { status = s; onStatus?.(s) }

  function dropWork(reason: Error) {
    for (const p of pending.values()) p.reject(reason)
    pending.clear()
    rendered.clear()
  }

  function shutdown() {
    settleLoad?.reject(new VoiceError('load', 'The HD voices were released.'))
    settleLoad = null
    loading = null
    dropWork(cancelled())
    worker?.terminate()
    worker = null
  }

  function fail(message: string) {
    const err = new VoiceError('load', message)
    report({ state: 'failed', progress: 0, error: message })
    settleLoad?.reject(err)
    settleLoad = null
    dropWork(err)
    shutdown() // a later attempt starts over
  }

  function arm(ms: number) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!worker) return
      // Still talking, or still downloading: check again later.
      if (active?.sounding() || status.state === 'loading') { arm(idleMs); return }
      release()
    }, ms)
  }

  function release() {
    if (timer) { clearTimeout(timer); timer = null }
    if (!worker) return
    shutdown()
    report({ state: 'idle', progress: 0 })
  }

  function onReply(msg: WorkerReply) {
    switch (msg.type) {
      case 'progress':
        report({ state: 'loading', progress: msg.total > 0 ? Math.min(1, msg.loaded / msg.total) : 0 })
        break
      case 'ready':
        report({ state: 'ready', progress: 1, device: msg.device })
        settleLoad?.resolve()
        settleLoad = null
        break
      case 'load-error':
        fail(msg.message)
        break
      case 'audio': // a reply for a cancelled render has no entry and is dropped
        pending.get(msg.id)?.resolve(msg.wav)
        pending.delete(msg.id)
        break
      case 'speak-error':
        pending.get(msg.id)?.reject(new VoiceError('chunk', msg.message))
        pending.delete(msg.id)
        break
    }
  }

  function load(): Promise<void> {
    if (loading) return loading
    loading = new Promise<void>((resolve, reject) => { settleLoad = { resolve, reject } })
    loading.catch(() => {}) // callers handle it; this copy must not count as unhandled
    report({ state: 'loading', progress: 0 })
    try {
      worker = makeWorker()
      worker.onmessage = (e) => onReply(e.data as WorkerReply)
      worker.onerror = (e) => fail(e.message || 'The HD voice worker stopped.')
      worker.postMessage({ type: 'load' })
    } catch (e) {
      const p = loading
      fail(e instanceof Error ? e.message : 'The HD voice worker could not start.')
      return p
    }
    return loading
  }

  const keyOf = (text: string, role: VoiceRole) => `${role}|${text}`

  function render(text: string, role: VoiceRole): Promise<ArrayBuffer> {
    leaving = false
    arm(idleMs)
    const key = keyOf(text, role)
    let p = rendered.get(key)
    if (!p) {
      p = load().then(() => new Promise<ArrayBuffer>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        worker!.postMessage({ type: 'speak', id, text, voice: KOKORO_VOICE[role] })
      }))
      p.catch(() => { if (rendered.get(key) === p) rendered.delete(key) })
      rendered.set(key, p)
    }
    return p
  }

  return {
    kind: 'hd',
    status: () => status,
    releaseSoon: (ms) => { if (worker) { leaving = true; arm(ms) } },
    release,
    prepare(text, role) { void render(text, role).catch(() => {}) },
    cancel() {
      if (worker) worker.postMessage({ type: 'cancel' })
      dropWork(cancelled())
    },
    speak(text, role, rate): SpeakHandle {
      active?.stop()
      let resolve!: () => void
      let reject!: (e: Error) => void
      const done = new Promise<void>((res, rej) => { resolve = res; reject = rej })
      let markStarted!: () => void
      const started = new Promise<void>((res) => { markStarted = res })
      let audio: AudioLike | null = null
      let stopped = false
      let paused = false
      let playing = false
      let speed = rate
      const finish = () => { playing = false; audio?.release(); audio = null; if (!leaving) arm(idleMs) }
      const failWith = (e: unknown) => {
        if (stopped) return
        finish()
        const name = (e as { name?: string } | null)?.name
        if (e instanceof VoiceError) reject(e)
        else if (name === 'NotAllowedError') reject(new VoiceError('blocked', 'The browser wants a tap before it plays sound.'))
        else reject(new VoiceError('chunk', e instanceof Error ? e.message : 'The HD audio could not play.'))
      }
      const start = (a: AudioLike) => {
        a.play().then(() => { if (audio === a) { playing = true; markStarted() } }, (e) => { if (audio === a) failWith(e) })
      }

      render(text, role).then((wav) => {
        rendered.delete(keyOf(text, role)) // played once; a replay renders again rather than holding memory
        if (stopped) return
        const a = makeAudio(wav)
        audio = a
        a.playbackRate = speed
        a.onended = () => { if (audio === a) { finish(); resolve() } }
        a.onerror = () => { if (audio === a) failWith(new VoiceError('chunk', 'The HD audio could not play.')) }
        if (!paused) start(a)
      }, failWith)

      const handle = {
        done,
        started,
        stop() { if (stopped) return; stopped = true; audio?.pause(); finish(); resolve() },
        pause() { paused = true; playing = false; audio?.pause() },
        resume() {
          if (!paused || stopped) return
          paused = false
          if (audio) start(audio)
        },
        setRate(r: number) { speed = r; if (audio) audio.playbackRate = r },
      }
      active = { stop: handle.stop, sounding: () => playing && !stopped }
      return handle
    },
    dispose() { active?.stop(); active = null },
  }
}

/** Real browser pieces: an <audio> element per chunk, with pitch kept at any speed. */
function browserAudio(wav: ArrayBuffer): AudioLike {
  const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
  const el = new Audio(url)
  el.preservesPitch = true
  const a: AudioLike = {
    get playbackRate() { return el.playbackRate },
    set playbackRate(r: number) { el.playbackRate = r },
    onended: null,
    onerror: null,
    play: () => el.play(),
    pause: () => el.pause(),
    release: () => { el.pause(); el.removeAttribute('src'); URL.revokeObjectURL(url) },
  }
  el.onended = () => a.onended?.()
  el.onerror = () => a.onerror?.()
  return a
}

let shared: HdEngine | null = null
const watchers = new Set<(s: HdStatus) => void>()

/** One HD engine per page visit, so the model loads once and survives moving from the room to the verdict. */
export function getHdEngine(): HdEngine {
  if (!shared) {
    const engine = createHdEngine({
      makeWorker: () => new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
      makeAudio: browserAudio,
      onStatus: (s) => watchers.forEach((fn) => fn(s)),
    })
    watchVoicePages((n) => { if (n === 0) engine.releaseSoon(LEAVE_MS) })
    shared = engine
  }
  return shared
}

export function watchHdStatus(fn: (s: HdStatus) => void): () => void {
  watchers.add(fn)
  return () => { watchers.delete(fn) }
}

export function hdSupported(): boolean {
  return typeof Worker === 'function' && typeof WebAssembly === 'object'
}
