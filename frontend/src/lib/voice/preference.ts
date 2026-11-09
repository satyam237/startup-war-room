/**
 * The listener's voice choice, remembered between visits. Instant voices are the default.
 * Remembering a choice never starts sound by itself.
 */
export type VoicePref = 'off' | 'instant' | 'hd'

export const VOICE_KEY = 'swr.voice'
export const HD_CONSENT_KEY = 'swr.voice.hdConsent'
export const SPEED_KEY = 'swr.voice.speed'

/** Speaking speeds offered everywhere (live and replay), as multiples of normal. */
export const SPEEDS = [1, 1.25, 1.5, 2] as const
export type Speed = (typeof SPEEDS)[number]

const PREFS: readonly VoicePref[] = ['off', 'instant', 'hd']

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null } // storage can be blocked
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* the choice just will not survive a reload */ }
}

export function getVoicePref(): VoicePref {
  const v = read(VOICE_KEY)
  return PREFS.includes(v as VoicePref) ? (v as VoicePref) : 'instant' // instant is the default: no download
}

export function setVoicePref(pref: VoicePref): void {
  write(VOICE_KEY, pref)
}

/** True once the listener has agreed to the one-time HD model download. */
export function hasHdConsent(): boolean {
  return read(HD_CONSENT_KEY) === '1'
}

export function rememberHdConsent(): void {
  write(HD_CONSENT_KEY, '1')
}

/** One speed for live and replay, remembered next to the voice choice. */
export function getSpeedPref(): Speed {
  const v = Number(read(SPEED_KEY))
  return (SPEEDS as readonly number[]).includes(v) ? (v as Speed) : 1
}

export function setSpeedPref(speed: Speed): void {
  write(SPEED_KEY, String(speed))
}
