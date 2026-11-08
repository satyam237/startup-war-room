/** The listener's voice choice, remembered between visits. Remembering it never starts sound by itself. */
export type VoicePref = 'off' | 'instant' | 'hd'

export const VOICE_KEY = 'swr.voice'
export const HD_CONSENT_KEY = 'swr.voice.hdConsent'

const PREFS: readonly VoicePref[] = ['off', 'instant', 'hd']

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null } // storage can be blocked
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* the choice just will not survive a reload */ }
}

export function getVoicePref(): VoicePref {
  const v = read(VOICE_KEY)
  return PREFS.includes(v as VoicePref) ? (v as VoicePref) : 'off'
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
