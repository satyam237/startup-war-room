import { useEffect, useState } from 'react'

/** How long the stream must go quiet before it counts as live. A replay arrives far faster than this. */
export const QUIET_MS = 400

/**
 * False while the stream is still replaying what happened before this page opened, true from then on.
 * After a reload the server resends every earlier event in one fast burst. The first quiet gap after
 * mount marks the end of that burst. A fresh debate is quiet right after its first setup event
 * (the first argument takes about 15 seconds), so everything live still animates.
 * `pulse` is anything that changes with each event, such as the last sequence number.
 */
export function useCaughtUp(pulse: unknown): boolean {
  const [caughtUp, setCaughtUp] = useState(false)
  useEffect(() => {
    if (caughtUp) return
    const t = window.setTimeout(() => setCaughtUp(true), QUIET_MS)
    return () => clearTimeout(t)
  }, [pulse, caughtUp])
  return caughtUp
}
