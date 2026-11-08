import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { stubMatchMedia } from '../../test-utils'
import { stage } from './timing'
import { useCalm } from './useCalm'

describe('staged delays', () => {
  it('returns the planned delay normally', () => {
    expect(stage(0.4, 2, false, 0.1)).toBeCloseTo(0.6)
    expect(stage(1.5, 0, false)).toBe(1.5)
  })
  it('skips every delay when calm', () => {
    expect(stage(0.4, 2, true, 0.1)).toBe(0)
    expect(stage(1.5, 0, true)).toBe(0)
  })
})

describe('useCalm', () => {
  it('is true when the visitor prefers reduced motion', () => {
    stubMatchMedia(true)
    expect(renderHook(() => useCalm()).result.current).toBe(true)
  })
  it('is false otherwise', () => {
    stubMatchMedia(false)
    expect(renderHook(() => useCalm()).result.current).toBe(false)
  })
  it('is false when matchMedia does not exist', () => {
    // @ts-expect-error simulate an old browser
    window.matchMedia = undefined
    expect(renderHook(() => useCalm()).result.current).toBe(false)
  })
})
