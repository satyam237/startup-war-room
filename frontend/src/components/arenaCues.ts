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
 * Decides when the big moments play, from the real stream state only:
 * the versus intro at the first turn, a title when the round number goes up by one,
 * and the bell when a checkpoint arrives. A reload mid-debate replays the stream in one burst;
 * those jumps are recognised (more than one step at once) and stay quiet.
 */
export function useArenaCues(state: DebateState, id: string, calm: boolean): ArenaCues {
  const [versus, setVersus] = useState(false)
  const [titleRound, setTitleRound] = useState<number | null>(null)
  const [bellFlash, setBellFlash] = useState(false)
  const versusUntil = useRef(0)
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

  useEffect(() => {
    if (turnCount !== 1) return
    const key = `swr.versus.${id}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch { /* private mode: it may play twice, which is harmless */ }
    if (calm) return
    versusUntil.current = Date.now() + VERSUS_MS
    setVersus(true)
    later(() => setVersus(false), VERSUS_MS)
  }, [turnCount, id, calm])

  useEffect(() => {
    const prev = lastRound.current
    lastRound.current = round
    if (round === 0 || round !== prev + 1) return
    const wait = Math.max(0, versusUntil.current - Date.now())
    const show = () => {
      setTitleRound(round)
      clearTimeout(titleTimer.current)
      titleTimer.current = window.setTimeout(() => setTitleRound(null), ROUND_TITLE_MS)
      timers.current.push(titleTimer.current)
    }
    if (wait === 0) show()
    else later(show, wait)
  }, [round])

  useEffect(() => {
    const prev = lastCheckpoints.current
    lastCheckpoints.current = checkpoints
    if (checkpoints !== prev + 1 || calm) return
    setBellFlash(true)
    clearTimeout(bellTimer.current)
    bellTimer.current = window.setTimeout(() => setBellFlash(false), BELL_FLASH_MS)
    timers.current.push(bellTimer.current)
  }, [checkpoints, calm])

  return { versus, titleRound, bellFlash }
}
