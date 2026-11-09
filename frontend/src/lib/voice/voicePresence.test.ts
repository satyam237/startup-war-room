import { describe, expect, it, vi } from 'vitest'
import { enterVoicePage, voicePageCount, watchVoicePages } from './voicePresence'

describe('voice page presence', () => {
  it('counts open voice pages and tells watchers when the last one closes', () => {
    const seen = vi.fn()
    const unwatch = watchVoicePages(seen)
    const leaveRoom = enterVoicePage()
    const leaveVerdict = enterVoicePage()
    leaveRoom()
    leaveRoom() // leaving twice counts once
    expect(voicePageCount()).toBe(1)
    leaveVerdict()
    expect(voicePageCount()).toBe(0)
    expect(seen.mock.calls.map((c) => c[0])).toEqual([1, 2, 1, 0])
    unwatch()
  })
})
