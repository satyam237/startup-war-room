import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { castInstantVoices, createInstantEngine, instantSupported } from './instantEngine'

type V = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService' | 'default' | 'voiceURI'>
const voice = (name: string, lang: string): V => ({ name, lang, localService: true, default: false, voiceURI: name })

class FakeUtterance {
  voice: V | null = null
  pitch = 1
  rate = 1
  lang = ''
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  constructor(public text: string) {}
}

function fakeSynth(voices: V[]) {
  const spoken: FakeUtterance[] = []
  let current: FakeUtterance | null = null
  const synth = {
    spoken,
    speak: vi.fn((u: FakeUtterance) => { spoken.push(u); current = u }),
    cancel: vi.fn(() => { const u = current; current = null; u?.onerror?.({ error: 'interrupted' }) }),
    getVoices: () => voices as SpeechSynthesisVoice[],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    end() { const u = current; current = null; u?.onend?.() },
  }
  return synth
}

describe('instant voices', () => {
  beforeEach(() => { vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance) })
  afterEach(() => vi.unstubAllGlobals())

  it('is reported missing, without throwing, where the browser has no speech API', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    expect(instantSupported()).toBe(false)
    expect(createInstantEngine()).toBeNull()
  })

  it('casts distinct English voices, matching gender where the name tells', () => {
    const cast = castInstantVoices([
      voice('Samantha', 'en-US'), voice('Daniel', 'en-GB'), voice('Karen', 'en-AU'),
      voice('Fred', 'en-US'), voice('Moira', 'en-IE'), voice('Thomas', 'fr-FR'), voice('Rishi', 'en-IN'),
    ] as SpeechSynthesisVoice[])
    const names = Object.values(cast).map((v) => v?.name)
    expect(names).not.toContain('Thomas')
    expect(new Set(names).size).toBe(6)
    expect(['Samantha', 'Karen', 'Moira']).toContain(cast.customer?.name)
    expect(['Daniel', 'Fred', 'Rishi']).toContain(cast.moderator?.name)
  })

  it('reuses voices when only a few are installed, and copes with none', () => {
    const one = castInstantVoices([voice('Alex', 'en-US')] as SpeechSynthesisVoice[])
    expect(Object.values(one).every((v) => v?.name === 'Alex')).toBe(true)
    const none = castInstantVoices([])
    expect(Object.values(none).every((v) => v === null)).toBe(true)
  })

  it('speaks a chunk with the role tone and resolves when it ends', async () => {
    const synth = fakeSynth([voice('Daniel', 'en-GB'), voice('Samantha', 'en-US')])
    const engine = createInstantEngine(synth as unknown as SpeechSynthesis)!
    const h = engine.speak('Hello there.', 'competitor', 1.25)
    const u = synth.spoken[0]
    expect(u.text).toBe('Hello there.')
    expect(u.rate).toBeGreaterThan(1)
    expect(u.voice).not.toBeNull()
    let ended = false
    void h.done.then(() => { ended = true })
    synth.end()
    await Promise.resolve()
    expect(ended).toBe(true)
  })

  it('gives the roles different pitch or rate so one installed voice still reads as several people', () => {
    const synth = fakeSynth([voice('Alex', 'en-US')])
    const engine = createInstantEngine(synth as unknown as SpeechSynthesis)!
    for (const r of ['vc', 'customer', 'cto', 'competitor', 'moderator', 'founder'] as const) engine.speak('x', r, 1)
    const tones = synth.spoken.map((u) => `${u.pitch}/${u.rate}`)
    expect(new Set(tones).size).toBe(6)
  })

  it('pause cancels the speech, and resume says the same chunk again', async () => {
    const synth = fakeSynth([voice('Alex', 'en-US')])
    const engine = createInstantEngine(synth as unknown as SpeechSynthesis)!
    const h = engine.speak('Same chunk.', 'vc', 1)
    let ended = false
    void h.done.then(() => { ended = true })
    h.pause()
    expect(synth.cancel).toHaveBeenCalled()
    await Promise.resolve()
    expect(ended).toBe(false) // the cancel is not the end of the chunk
    h.resume()
    expect(synth.spoken.map((u) => u.text)).toEqual(['Same chunk.', 'Same chunk.'])
    synth.end()
    await Promise.resolve()
    expect(ended).toBe(true)
  })

  it('a speed change restarts the chunk at the new rate', () => {
    const synth = fakeSynth([voice('Alex', 'en-US')])
    const engine = createInstantEngine(synth as unknown as SpeechSynthesis)!
    const h = engine.speak('Faster.', 'vc', 1)
    const before = synth.spoken[0].rate
    h.setRate(1.5)
    expect(synth.spoken).toHaveLength(2)
    expect(synth.spoken[1].rate).toBeCloseTo(before * 1.5)
  })

  it('rejects when the browser refuses to speak', async () => {
    const synth = fakeSynth([voice('Alex', 'en-US')])
    const engine = createInstantEngine(synth as unknown as SpeechSynthesis)!
    const h = engine.speak('No.', 'vc', 1)
    synth.spoken[0].onerror?.({ error: 'not-allowed' })
    await expect(h.done).rejects.toThrow('not-allowed')
  })
})
