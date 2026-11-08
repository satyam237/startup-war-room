/**
 * HD voices: Kokoro-82M running in a Web Worker (kokoro.worker.ts), so rendering never blocks the page.
 * Nothing loads until the first chunk is requested. The model stays loaded for the rest of the visit,
 * and the browser caches its files, so later visits skip the download.
 */
import { KOKORO_VOICE } from './cast'
import type { SpeakHandle, VoiceEngine, VoiceRole } from './types'

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
}

export class HdLoadError extends Error {}

export function createHdEngine({ makeWorker, makeAudio, onStatus }: Deps): VoiceEngine & { status(): HdStatus } {
  let worker: WorkerLike | null = null
  let status: HdStatus = { state: 'idle', progress: 0 }
  let loading: Promise<void> | null = null
  let settleLoad: { resolve(): void; reject(e: Error): void } | null = null
  let nextId = 1
  const pending = new Map<number, { resolve(wav: ArrayBuffer): void; reject(e: Error): void }>()
  const rendered = new Map<string, Promise<ArrayBuffer>>()
  let active: { stop(): void } | null = null

  const report = (s: HdStatus) => { status = s; onStatus?.(s) }

  function fail(message: string) {
    const err = new HdLoadError(message)
    report({ state: 'failed', progress: 0, error: message })
    settleLoad?.reject(err)
    settleLoad = null
    loading = null // a later attempt may try again
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    rendered.clear()
    worker?.terminate()
    worker = null
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
      case 'audio':
        pending.get(msg.id)?.resolve(msg.wav)
        pending.delete(msg.id)
        break
      case 'speak-error':
        pending.get(msg.id)?.reject(new Error(msg.message))
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

  function render(text: string, role: VoiceRole): Promise<ArrayBuffer> {
    const key = `${role}|${text}`
    let p = rendered.get(key)
    if (!p) {
      p = load().then(() => new Promise<ArrayBuffer>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        worker!.postMessage({ type: 'speak', id, text, voice: KOKORO_VOICE[role] })
      }))
      p.catch(() => rendered.delete(key))
      rendered.set(key, p)
    }
    return p
  }

  return {
    kind: 'hd',
    status: () => status,
    prepare(text, role) { void render(text, role).catch(() => {}) },
    speak(text, role, rate): SpeakHandle {
      active?.stop()
      let resolve!: () => void
      let reject!: (e: Error) => void
      const done = new Promise<void>((res, rej) => { resolve = res; reject = rej })
      let audio: AudioLike | null = null
      let stopped = false
      let paused = false
      let speed = rate
      const finish = () => { audio?.release(); audio = null }

      render(text, role).then((wav) => {
        rendered.delete(`${role}|${text}`) // played once; a replay renders again rather than holding memory
        if (stopped) return
        const a = makeAudio(wav)
        audio = a
        a.playbackRate = speed
        a.onended = () => { if (audio === a) { finish(); resolve() } }
        a.onerror = () => { if (audio === a) { finish(); reject(new Error('The HD audio could not play.')) } }
        if (!paused) a.play().catch((e) => { if (audio === a) { finish(); reject(e instanceof Error ? e : new Error(String(e))) } })
      }, (e) => { if (!stopped) reject(e) })

      const handle = {
        done,
        stop() { if (stopped) return; stopped = true; audio?.pause(); finish(); resolve() },
        pause() { paused = true; audio?.pause() },
        resume() {
          if (!paused || stopped) return
          paused = false
          audio?.play().catch(() => {})
        },
        setRate(r: number) { speed = r; if (audio) audio.playbackRate = r },
      }
      active = handle
      return handle
    },
    dispose() { active?.stop(); active = null },
  }
}

/** Real browser pieces: a module worker, and an <audio> element per chunk with pitch kept at any speed. */
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

let shared: (VoiceEngine & { status(): HdStatus }) | null = null
const watchers = new Set<(s: HdStatus) => void>()

/** One HD engine per page visit, so the model loads once and survives moving from the room to the verdict. */
export function getHdEngine(): VoiceEngine & { status(): HdStatus } {
  shared ??= createHdEngine({
    makeWorker: () => new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    makeAudio: browserAudio,
    onStatus: (s) => watchers.forEach((fn) => fn(s)),
  })
  return shared
}

export function watchHdStatus(fn: (s: HdStatus) => void): () => void {
  watchers.add(fn)
  return () => { watchers.delete(fn) }
}

export function hdSupported(): boolean {
  return typeof Worker === 'function' && typeof WebAssembly === 'object'
}
