import { chunkText } from './chunk'
import { VoiceError, type Line, type SpeakHandle, type VoiceEngine } from './types'

export type NarratorStatus = 'idle' | 'playing' | 'paused' | 'waiting' | 'ended'

export interface NarratorSnapshot {
  status: NarratorStatus
  /** The line being spoken, or next to be spoken. */
  index: number
  /** The chunk of that line, for captions. */
  chunk: number
  chunks: string[]
  rate: number
  /** False while the current chunk is still being prepared (HD renders before it plays). */
  sounding: boolean
}

interface Options {
  /** Live mode waits for more lines at the end instead of ending. */
  live: boolean
  /** Called for failures the narrator cannot handle by itself: a dead engine, or a browser block. */
  onEngineError?: (error: Error) => void
  /** Starting speed, as a multiple of normal. */
  rate?: number
}

/** How many chunks to render ahead of the one playing. Enough to cover a turn change, small enough to drop cheaply. */
export const LOOKAHEAD = 3

/**
 * Plays a list of lines through a voice engine, one chunk at a time. Knows nothing about React or the
 * browser. Never makes a sound until `play` is called. Each run carries a generation number, so a late
 * finish from a stopped chunk can never move the queue. The current line is followed by its key, so a
 * list that is rebuilt around it (a reload, a reordering) does not make it jump.
 */
export class Narrator {
  private lines: Line[] = []
  private engine: VoiceEngine | null = null
  private handle: SpeakHandle | null = null
  private currentKey: string | null = null
  private gen = 0
  private listeners = new Set<() => void>()
  private snap: NarratorSnapshot = { status: 'idle', index: 0, chunk: 0, chunks: [], rate: 1, sounding: false }
  private readonly opts: Options

  constructor(opts: Options) {
    this.opts = opts
    if (opts.rate) this.snap = { ...this.snap, rate: opts.rate }
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
    // Keep pointing at the line being spoken if the list was rebuilt around it.
    const at = this.currentKey === null ? -1 : lines.findIndex((l) => l.key === this.currentKey)
    if (at >= 0 && at !== this.snap.index) this.set({ index: at })
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

  next() {
    if (this.snap.index >= this.lines.length - 1) return // already on the last line
    this.play(this.snap.index + 1)
  }

  prev() { this.play(Math.max(this.snap.index - 1, 0)) }

  /** Skips the backlog: plays the newest line. */
  jumpToLive() {
    if (this.lines.length) this.play(this.lines.length - 1)
  }

  /** Applies to the chunk in hand where the engine can (HD), otherwise from the next chunk. Never restarts a line. */
  setRate(rate: number) {
    this.handle?.setRate(rate)
    this.set({ rate })
  }

  stop() {
    this.halt()
    this.set({ status: 'idle', sounding: false })
  }

  dispose() {
    this.stop()
    this.listeners.clear()
  }

  /** Stops the chunk in hand and throws away anything rendered ahead. */
  private halt() {
    this.gen += 1
    this.handle?.stop()
    this.handle = null
    this.engine?.cancel?.()
  }

  /** The next few chunks after (index, chunk), across line boundaries. */
  private ahead(index: number, chunk: number) {
    const out: { text: string; voice: Line['voice'] }[] = []
    let i = index
    let c = chunk + 1
    while (out.length < LOOKAHEAD && i < this.lines.length) {
      const chunks = chunkText(this.lines[i].text)
      if (c < chunks.length) { out.push({ text: chunks[c], voice: this.lines[i].voice }); c += 1 }
      else { i += 1; c = 0 }
    }
    return out
  }

  private async run() {
    this.halt()
    const gen = this.gen
    const engine = this.engine
    if (!engine) return
    let retried = false
    while (gen === this.gen) {
      const { index, chunk } = this.snap
      const line = this.lines[index]
      if (!line) {
        this.currentKey = null
        this.set({ status: this.opts.live ? 'waiting' : 'ended', chunks: [], sounding: false })
        return
      }
      const chunks = chunkText(line.text)
      if (chunk >= chunks.length) {
        this.set({ index: index + 1, chunk: 0 })
        continue
      }
      this.currentKey = line.key
      const handle = engine.speak(chunks[chunk], line.voice, this.snap.rate)
      this.handle = handle
      this.set({ status: 'playing', chunks, sounding: !handle.started })
      handle.started?.then(() => { if (gen === this.gen) this.set({ sounding: true }) }, () => {})
      for (const a of this.ahead(index, chunk)) engine.prepare?.(a.text, a.voice)
      try {
        await handle.done
      } catch (e) {
        if (gen !== this.gen) return
        this.handle = null
        if (e instanceof VoiceError && e.kind === 'chunk') {
          // Paused while it was rendering: stay paused on this chunk; resume tries it again.
          if (this.snap.status === 'paused') return
          // One bad chunk: try it once more, then move past it on the same engine.
          if (!retried) { retried = true; continue }
          retried = false
          this.set({ chunk: chunk + 1 })
          continue
        }
        this.set({ status: 'paused', sounding: false })
        this.opts.onEngineError?.(e instanceof Error ? e : new Error(String(e)))
        return
      }
      if (gen !== this.gen) return
      retried = false
      this.handle = null
      // Find the line again by key: the list may have been rebuilt while it played.
      const now = this.lines.findIndex((l) => l.key === line.key)
      if (now === -1) this.set({ chunk: 0 }) // it is gone; whatever took its place is next
      else this.set({ index: now, chunk: chunk + 1 })
    }
  }
}
