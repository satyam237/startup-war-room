import { chunkText } from './chunk'
import type { Line, SpeakHandle, VoiceEngine } from './types'

export type NarratorStatus = 'idle' | 'playing' | 'paused' | 'waiting' | 'ended'

export interface NarratorSnapshot {
  status: NarratorStatus
  /** The line being spoken, or next to be spoken. */
  index: number
  /** The chunk of that line, for captions. */
  chunk: number
  chunks: string[]
  rate: number
}

interface Options {
  /** Live mode waits for more lines at the end instead of ending. */
  live: boolean
  onEngineError?: (error: Error) => void
}

/**
 * Plays a list of lines through a voice engine, one chunk at a time. Knows nothing about React or the
 * browser. Never makes a sound until `play` is called. Each run carries a generation number, so a late
 * finish from a stopped chunk can never move the queue.
 */
export class Narrator {
  private lines: Line[] = []
  private engine: VoiceEngine | null = null
  private handle: SpeakHandle | null = null
  private gen = 0
  private listeners = new Set<() => void>()
  private snap: NarratorSnapshot = { status: 'idle', index: 0, chunk: 0, chunks: [], rate: 1 }
  private readonly opts: Options

  constructor(opts: Options) {
    this.opts = opts
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  getSnapshot = () => this.snap

  get engineKind() { return this.engine?.kind ?? null }

  private set(patch: Partial<NarratorSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  setEngine(engine: VoiceEngine) {
    if (engine === this.engine) return
    const wasPlaying = this.snap.status === 'playing'
    this.halt()
    this.engine = engine
    if (wasPlaying) void this.run()
  }

  setLines(lines: Line[]) {
    const grew = lines.length !== this.lines.length
    this.lines = lines
    if (this.snap.status === 'waiting' && this.snap.index < lines.length) void this.run()
    else if (grew) this.set({})
  }

  /** Starts at `index` (from its first chunk), or carries on from where it stopped. */
  play(index?: number) {
    if (index !== undefined) this.set({ index: Math.max(0, Math.min(index, Math.max(0, this.lines.length - 1))), chunk: 0 })
    else if (this.snap.status === 'ended') this.set({ index: 0, chunk: 0 })
    void this.run()
  }

  pause() {
    if (this.snap.status !== 'playing') return
    this.handle?.pause()
    this.set({ status: 'paused' })
  }

  resume() {
    if (this.snap.status !== 'paused') return
    if (this.handle) {
      this.handle.resume()
      this.set({ status: 'playing' })
    } else {
      void this.run()
    }
  }

  next() { this.play(Math.min(this.snap.index + 1, this.lines.length - 1)) }
  prev() { this.play(Math.max(this.snap.index - 1, 0)) }

  /** Skips the backlog: plays the newest line. */
  jumpToLive() {
    if (this.lines.length) this.play(this.lines.length - 1)
  }

  setRate(rate: number) {
    this.handle?.setRate(rate)
    this.set({ rate })
  }

  stop() {
    this.halt()
    this.set({ status: 'idle' })
  }

  dispose() {
    this.stop()
    this.listeners.clear()
  }

  private halt() {
    this.gen += 1
    this.handle?.stop()
    this.handle = null
  }

  private async run() {
    this.halt()
    const gen = this.gen
    const engine = this.engine
    if (!engine) return
    while (gen === this.gen) {
      const { index, chunk } = this.snap
      const line = this.lines[index]
      if (!line) {
        this.set({ status: this.opts.live ? 'waiting' : 'ended', chunks: [] })
        return
      }
      const chunks = chunkText(line.text)
      if (chunk >= chunks.length) {
        this.set({ index: index + 1, chunk: 0 })
        continue
      }
      const handle = engine.speak(chunks[chunk], line.voice, this.snap.rate)
      this.handle = handle
      this.set({ status: 'playing', chunks })
      const after = chunk + 1 < chunks.length
        ? { text: chunks[chunk + 1], voice: line.voice }
        : this.lines[index + 1] && { text: chunkText(this.lines[index + 1].text)[0], voice: this.lines[index + 1].voice }
      if (after?.text) engine.prepare?.(after.text, after.voice)
      try {
        await handle.done
      } catch (e) {
        if (gen !== this.gen) return
        this.handle = null
        this.set({ status: 'paused' })
        this.opts.onEngineError?.(e instanceof Error ? e : new Error(String(e)))
        return
      }
      if (gen !== this.gen) return
      this.handle = null
      this.set({ chunk: chunk + 1 })
    }
  }
}
