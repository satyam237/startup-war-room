import { vi } from 'vitest'

/** A stand-in for the browser's speech synthesis. Utterances wait until the test ends them. */
export class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null
  pitch = 1
  rate = 1
  lang = ''
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  constructor(public text: string) {}
}

export function installFakeSpeech() {
  const spoken: FakeUtterance[] = []
  let current: FakeUtterance | null = null
  const synth = {
    spoken,
    get current() { return current },
    speak: vi.fn((u: FakeUtterance) => { spoken.push(u); current = u }),
    cancel: vi.fn(() => { const u = current; current = null; u?.onerror?.({ error: 'interrupted' }) }),
    getVoices: () => [{ name: 'Daniel', lang: 'en-GB', localService: true, default: true, voiceURI: 'Daniel' }] as SpeechSynthesisVoice[],
    addEventListener: () => {},
    removeEventListener: () => {},
    /** Finishes the utterance being spoken. */
    end() { const u = current; current = null; u?.onend?.() },
  }
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  return synth
}
