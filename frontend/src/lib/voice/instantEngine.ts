/**
 * Instant voices: the browser's own speech synthesis. No download. Each role gets the most distinct
 * installed English voice available plus its own pitch and rate, so a device with one voice still
 * gives six people.
 */
import { CAST_ORDER, ROLE_GENDER, ROLE_TONE } from './cast'
import { VoiceError, type SpeakHandle, type VoiceEngine, type VoiceRole } from './types'

const FEMALE = /female|woman|samantha|victoria|karen|moira|tessa|fiona|veena|zira|aria|jenny|susan|serena|kate|libby|sonia|natasha|hazel|allison|ava|joanna|salli|kimberly|emma|amy|olivia|catherine|nicky/i
const MALE = /\bmale\b|\bman\b|daniel|alex|fred|david|mark|guy|george|arthur|oliver|rishi|aaron|tom|ryan|thomas|william|james|brian|matthew|justin|joey|eric|lee|gordon/i

/** macOS ships joke and effect voices with English locales. They would turn a debate into a cartoon. */
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|kathy|deranged|hysterical|pipe organ)\b/i

type Cast = Record<VoiceRole, SpeechSynthesisVoice | null>

function gender(v: SpeechSynthesisVoice): 'm' | 'f' | null {
  if (FEMALE.test(v.name)) return 'f'
  if (MALE.test(v.name)) return 'm'
  return null
}

const sameVoice = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) => a.voiceURI === b.voiceURI && a.name === b.name

export function instantSupported(): boolean {
  return typeof globalThis.speechSynthesis !== 'undefined' && globalThis.speechSynthesis !== null
    && typeof globalThis.SpeechSynthesisUtterance === 'function'
}

/**
 * Picks a voice per role from what is installed: English only, a different voice per role while any are
 * left (spreading accents), matching the wanted gender where the name gives it away. Falls back to
 * sharing voices, and to null (the browser default) when there are none. Roles in `fixed` keep their voice.
 */
export function castInstantVoices(all: SpeechSynthesisVoice[], fixed: Partial<Cast> = {}): Cast {
  const usable = all.filter((v) => !NOVELTY.test(v.name))
  const english = usable.filter((v) => /^en([-_]|$)/i.test(v.lang))
  const pool = english.length ? english : usable.length ? usable : all
  const used = new Set<SpeechSynthesisVoice>()
  const usedLangs = new Set<string>()
  const cast = {} as Cast
  for (const role of CAST_ORDER) {
    const keep = fixed[role]
    const present = keep ? all.find((v) => sameVoice(v, keep)) : undefined
    if (present) { cast[role] = present; used.add(present); usedLangs.add(present.lang) }
  }
  for (const role of CAST_ORDER) {
    if (cast[role]) continue
    const free = pool.filter((v) => !used.has(v))
    const score = (v: SpeechSynthesisVoice) =>
      (gender(v) === ROLE_GENDER[role] ? 4 : gender(v) === null ? 1 : 0) + (usedLangs.has(v.lang) ? 0 : 2) + (v.localService ? 1 : 0)
    const best = (free.length ? free : pool).reduce<SpeechSynthesisVoice | null>((a, v) => (a === null || score(v) > score(a) ? v : a), null)
    cast[role] = best
    if (best) { used.add(best); usedLangs.add(best.lang) }
  }
  return cast
}

export function createInstantEngine(synth: SpeechSynthesis | undefined = globalThis.speechSynthesis): VoiceEngine | null {
  if (!synth || typeof globalThis.SpeechSynthesisUtterance !== 'function') return null
  // Voices often arrive after page load (Chrome fires voiceschanged; Safari may only fill getVoices later).
  // Recast when they do, but a role that has already spoken keeps its voice, so nobody changes mid-debate.
  const locked: Partial<Cast> = {}
  let known = -1
  let cast: Cast = castInstantVoices([])
  const recast = () => {
    const voices = synth.getVoices()
    known = voices.length
    cast = castInstantVoices(voices, locked)
  }
  const castFor = (role: VoiceRole) => {
    if (synth.getVoices().length !== known) recast()
    const v = cast[role]
    if (v) locked[role] = v
    return v
  }
  synth.addEventListener?.('voiceschanged', recast)

  // Chrome can drop, or fire a stale error at, an utterance spoken in the same task as cancel().
  // After a cancel the next speak waits one task.
  let cancelledThisTask = false
  const cancel = () => {
    synth.cancel()
    if (!cancelledThisTask) { cancelledThisTask = true; setTimeout(() => { cancelledThisTask = false }, 0) }
  }

  let active: { stop(): void } | null = null

  return {
    kind: 'instant',
    speak(text, role, rate): SpeakHandle {
      active?.stop() // one voice at a time
      let resolve!: () => void
      let reject!: (e: Error) => void
      const done = new Promise<void>((res, rej) => { resolve = res; reject = rej })
      let current: SpeechSynthesisUtterance | null = null
      let waiting: ReturnType<typeof setTimeout> | null = null
      let paused = false
      let stopped = false
      let speed = rate

      const sayNow = () => {
        waiting = null
        if (stopped || paused) return
        const u = new SpeechSynthesisUtterance(text)
        const v = castFor(role)
        if (v) { u.voice = v; u.lang = v.lang }
        u.pitch = ROLE_TONE[role].pitch
        u.rate = ROLE_TONE[role].rate * speed
        // Cancelling (pause, speed change, stop) fires end or error on the old utterance; only the current one counts.
        u.onend = () => { if (u === current && !paused && !stopped) { current = null; resolve() } }
        u.onerror = (e) => {
          if (u !== current || paused || stopped) return
          current = null
          if (e.error === 'interrupted' || e.error === 'canceled') resolve()
          else if (e.error === 'not-allowed') reject(new VoiceError('blocked', 'The browser wants a tap before it speaks.'))
          else reject(new VoiceError('chunk', e.error))
        }
        current = u
        synth.speak(u)
      }
      const say = () => {
        if (waiting) clearTimeout(waiting)
        if (cancelledThisTask) waiting = setTimeout(sayNow, 0)
        else sayNow()
      }
      // Only cancel speech this handle owns, so a finished chunk never cancels the next one.
      const silence = () => {
        if (waiting) { clearTimeout(waiting); waiting = null }
        if (current) { current = null; cancel() }
      }

      const handle = {
        done,
        stop() { if (stopped) return; stopped = true; silence(); resolve() },
        pause() { if (stopped || paused) return; paused = true; silence() },
        // Browsers resume speech unreliably, so resume says the chunk again from its start. Chunks are short.
        resume() { if (stopped || !paused) return; paused = false; say() },
        setRate(r: number) { speed = r; if (!stopped && !paused) { silence(); say() } },
      }
      active = handle
      say()
      return handle
    },
    dispose() {
      active?.stop()
      active = null
      synth.removeEventListener?.('voiceschanged', recast)
    },
  }
}
