import { describe, expect, it, vi } from 'vitest'
import { HD_CONSENT_KEY, VOICE_KEY, getVoicePref, hasHdConsent, rememberHdConsent, setVoicePref } from './preference'

describe('voice preference', () => {
  it('defaults to off', () => {
    expect(getVoicePref()).toBe('off')
  })

  it('remembers off, instant and HD', () => {
    for (const p of ['instant', 'hd', 'off'] as const) {
      setVoicePref(p)
      expect(localStorage.getItem(VOICE_KEY)).toBe(p)
      expect(getVoicePref()).toBe(p)
    }
  })

  it('ignores a value it does not know', () => {
    localStorage.setItem(VOICE_KEY, 'loud')
    expect(getVoicePref()).toBe('off')
  })

  it('remembers that the HD download was agreed to', () => {
    expect(hasHdConsent()).toBe(false)
    rememberHdConsent()
    expect(localStorage.getItem(HD_CONSENT_KEY)).toBe('1')
    expect(hasHdConsent()).toBe(true)
  })

  it('survives blocked storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getVoicePref()).toBe('off')
    expect(() => setVoicePref('hd')).not.toThrow()
    spy.mockRestore()
    set.mockRestore()
  })
})
