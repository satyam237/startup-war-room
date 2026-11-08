import { describe, expect, it, vi } from 'vitest'
import { HD_CONSENT_KEY, SPEEDS, SPEED_KEY, VOICE_KEY, getSpeedPref, getVoicePref, hasHdConsent, rememberHdConsent, setSpeedPref, setVoicePref } from './preference'

describe('voice preference', () => {
  it('defaults to the instant voices', () => {
    expect(getVoicePref()).toBe('instant')
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
    expect(getVoicePref()).toBe('instant')
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
    expect(getVoicePref()).toBe('instant')
    expect(() => setVoicePref('hd')).not.toThrow()
    spy.mockRestore()
    set.mockRestore()
  })

  it('offers 1x, 1.25x, 1.5x and 2x, defaults to 1x, and remembers the choice', () => {
    expect([...SPEEDS]).toEqual([1, 1.25, 1.5, 2])
    expect(getSpeedPref()).toBe(1)
    setSpeedPref(2)
    expect(localStorage.getItem(SPEED_KEY)).toBe('2')
    expect(getSpeedPref()).toBe(2)
    localStorage.setItem(SPEED_KEY, '3')
    expect(getSpeedPref()).toBe(1)
  })
})
