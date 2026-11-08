/**
 * Instant voices: the browser's own speech synthesis. No download. Each role gets the most distinct
 * installed English voice available plus its own pitch and rate, so a device with one voice still
 * gives six people.
 */
import { CAST_ORDER, ROLE_GENDER, ROLE_TONE } from './cast'
import type { SpeakHandle, VoiceEngine, VoiceRole } from './types'

const FEMALE = /female|woman|samantha|victoria|karen|moira|tessa|fiona|veena|zira|aria|jenny|susan|serena|kate|libby|sonia|natasha|hazel|allison|ava|joanna|salli|kimberly|emma|amy|olivia|catherine|nicky/i
const MALE = /\bmale\b|\bman\b|daniel|alex|fred|david|mark|guy|george|arthur|oliver|rishi|aaron|tom|ryan|thomas|william|james|brian|matthew|justin|joey|eric|lee|gordon/i

function gender(v: SpeechSynthesisVoice): 'm' | 'f' | null {
  if (FEMALE.test(v.name)) return 'f'
  if (MALE.test(v.name)) return 'm'
  return null
}

export function instantSupported(): boolean {
  return typeof globalThis.speechSynthesis !== 'undefined' && globalThis.speechSynthesis !== null
    && typeof globalThis.SpeechSynthesisUtterance === 'function'
}

/**
 * Picks a voice per role from what is installed: English only, a different voice per role while any are
 * left (spreading accents), matching the wanted gender where the name gives it away. Falls back to
 * sharing voices, and to null (the browser default) when there are none.
 */
export function castInstantVoices(all: SpeechSynthesisVoice[]): Record<VoiceRole, SpeechSynthesisVoice | null> {
  const english = all.filter((v) => /^en([-_]|$)/i.test(v.lang))
  const pool = english.length ? english : all
  const used = new Set<SpeechSynthesisVoice>()
  const usedLangs = new Set<string>()
  const cast = {} as Record<VoiceRole, SpeechSynthesisVoice | null>
  for (const role of CAST_ORDER) {
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
  let cast: Record<VoiceRole, SpeechSynthesisVoice | null> | null = null
  let castFrom = -1
  const castFor = (role: VoiceRole) => {
    const voices = synth.getVoices()
    // Voices often arrive after page load (the voiceschanged event), so recast whenever the list grows.
    if (!cast || voices.length !== castFrom) { cast = castInstantVoices(voices); castFrom = voices.length }
    return cast[role]
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
      let paused = false
      let stopped = false
      let speed = rate

      const say = () => {
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
          else reject(new Error(e.error))
        }
        current = u
        synth.speak(u)
      }
      const silence = () => { current = null; synth.cancel() }

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
    dispose() { active?.stop(); active = null },
  }
}
