import { useEffect, useRef, useState } from 'react'
import type { DebateState } from '../lib/debateReducer'
import { BELL_FLASH_MS } from './motion/BellFlash'
import { ROUND_TITLE_MS } from './motion/RoundTitle'
import { VERSUS_MS } from './motion/VersusIntro'

export interface ArenaCues {
  versus: boolean
  titleRound: number | null
  bellFlash: boolean
}

/**
 * Decides when the big moments play, from the real stream state only: the versus intro at the first turn,
 * a title when a new round begins, and the bell when a checkpoint arrives. A title never plays over the
 * intro or the bell. Until `caughtUp` (see useCaughtUp) the stream is replaying an earlier part of the
 * debate, so nothing plays; the counts still move, so nothing fires late for what was replayed.
 */
export function useArenaCues(state: DebateState, id: string, calm: boolean, caughtUp: boolean): ArenaCues {
  const [versus, setVersus] = useState(false)
  const [titleRound, setTitleRound] = useState<number | null>(null)
  const [bellFlash, setBellFlash] = useState(false)
  const versusUntil = useRef(0)
  const bellUntil = useRef(0)
  const lastTurns = useRef(0)
  const lastRound = useRef(0)
  const lastCheckpoints = useRef(0)
  const timers = useRef<number[]>([])
  const titleTimer = useRef(0)
  const bellTimer = useRef(0)

  const turnCount = state.order.length
  const round = Math.max(0, ...state.order.map((t) => state.turns[t].round))
  const checkpoints = state.checkpoints.length

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)) }

  // The effects below run in this order, so a title decided in the same render already sees the bell.
  useEffect(() => {
    const prev = lastTurns.current
    lastTurns.current = turnCount
    if (!caughtUp || prev !== 0 || turnCount !== 1) return
    const key = `swr.versus.${id}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch { /* private mode: it may play twice, which is harmless */ }
    if (calm) return
    versusUntil.current = Date.now() + VERSUS_MS
    setVersus(true)
    later(() => setVersus(false), VERSUS_MS)
  }, [turnCount, id, calm, caughtUp])

  useEffect(() => {
    const prev = lastCheckpoints.current
    lastCheckpoints.current = checkpoints
    if (!caughtUp || checkpoints !== prev + 1 || calm) return
    bellUntil.current = Date.now() + BELL_FLASH_MS
    setBellFlash(true)
    clearTimeout(bellTimer.current)
    bellTimer.current = window.setTimeout(() => setBellFlash(false), BELL_FLASH_MS)
    timers.current.push(bellTimer.current)
  }, [checkpoints, calm, caughtUp])

  useEffect(() => {
    const prev = lastRound.current
    lastRound.current = round
    if (!caughtUp || round === 0 || round !== prev + 1) return
    const wait = Math.max(0, versusUntil.current - Date.now(), bellUntil.current - Date.now())
    const show = () => {
      if (lastRound.current !== round) return // a newer round started while this title waited
      setTitleRound(round)
      clearTimeout(titleTimer.current)
      titleTimer.current = window.setTimeout(() => setTitleRound(null), ROUND_TITLE_MS)
      timers.current.push(titleTimer.current)
    }
    if (wait === 0) show()
    else later(show, wait)
  }, [round, caughtUp])

  return { versus, titleRound, bellFlash }
}
