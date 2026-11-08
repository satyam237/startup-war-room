import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Narrator } from '../../lib/voice/narrator'
import { createInstantEngine } from '../../lib/voice/instantEngine'
import { getVoicePref, setVoicePref, type VoicePref } from '../../lib/voice/preference'
import type { HdStatus } from '../../lib/voice/hdEngine'
import type { Line, VoiceEngine } from '../../lib/voice/types'

type Engine = 'instant' | 'hd'

/**
 * The narrator for one page, wired to React. Sound starts only from `start` (a click). The HD engine's
 * code, worker and model are fetched only when HD is first used. Leaving the page stops the voice.
 */
export function useBroadcast(lines: Line[], live: boolean) {
  const [pref, setPrefState] = useState<VoicePref>(getVoicePref)
  const [hd, setHd] = useState<HdStatus>({ state: 'idle', progress: 0 })
  const [notice, setNotice] = useState<string | null>(null)
  const instant = useMemo(() => createInstantEngine(), [])
  const onError = useRef<(e: Error) => void>(() => {})
  const [narrator] = useState(() => new Narrator({ live, onEngineError: (e) => onError.current(e) }))
  const snap = useSyncExternalStore(narrator.subscribe, narrator.getSnapshot)
  const unwatch = useRef<(() => void) | null>(null)
  const wanted = useRef(0) // the latest engine request; an older one that resolves late is dropped

  useEffect(() => { narrator.setLines(lines) }, [narrator, lines])

  useEffect(() => {
    const stop = () => narrator.stop()
    window.addEventListener('pagehide', stop)
    return () => {
      window.removeEventListener('pagehide', stop)
      narrator.stop()
      unwatch.current?.()
      unwatch.current = null
    }
  }, [narrator])

  const remember = useCallback((p: VoicePref) => { setVoicePref(p); setPrefState(p) }, [])

  const engineFor = useCallback(async (kind: Engine): Promise<VoiceEngine | null> => {
    if (kind === 'instant') return instant
    const mod = await import('../../lib/voice/hdEngine')
    const engine = mod.getHdEngine()
    unwatch.current ??= mod.watchHdStatus(setHd)
    setHd(engine.status())
    return engine
  }, [instant])

  /** Starts speaking with the chosen engine. `at` picks the line; otherwise it carries on. */
  const start = useCallback(async (kind: Engine, at?: number) => {
    const ticket = ++wanted.current
    setNotice(null)
    // Instant voices start inside the click itself, which is what browsers want before they make sound.
    const engine = kind === 'instant' ? instant : await engineFor(kind)
    if (ticket !== wanted.current) return
    if (!engine) { setNotice('This browser has no built-in voices. Try HD voices instead.'); return }
    narrator.setEngine(engine)
    narrator.play(at)
  }, [engineFor, instant, narrator])

  onError.current = (e) => {
    if (narrator.engineKind === 'hd' && instant) {
      setNotice(`HD voices could not load (${e.message}). The instant voices are reading instead.`)
      remember('instant')
      narrator.setEngine(instant)
      narrator.play()
    } else {
      setNotice('The browser stopped the voice. Press play to try again.')
    }
  }

  /** Switches engine. Keeps talking if it was talking; otherwise only remembers the choice. */
  const choose = useCallback((p: VoicePref, thenPlay: boolean) => {
    remember(p)
    if (p === 'off') { wanted.current++; narrator.stop(); return }
    const { status } = narrator.getSnapshot()
    if (status === 'playing' || status === 'waiting' || thenPlay) void start(p, undefined)
  }, [narrator, remember, start])

  return {
    pref,
    snap,
    hd,
    notice,
    instantAvailable: instant !== null,
    /** The engine to use for play: the remembered one, or instant when voice is off. */
    engine: (pref === 'hd' ? 'hd' : 'instant') as Engine,
    start,
    choose,
    remember,
    pause: () => narrator.pause(),
    resume: () => narrator.resume(),
    next: () => narrator.next(),
    prev: () => narrator.prev(),
    jumpToLive: () => narrator.jumpToLive(),
    setRate: (r: number) => narrator.setRate(r),
    stop: () => { wanted.current++; narrator.stop() },
  }
}
