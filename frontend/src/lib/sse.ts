import type { DebateAction, DebateEventName } from './debateReducer'
import { API_BASE } from './api'

const CLOSED = 2 // EventSource.CLOSED

const EVENTS: DebateEventName[] = [
  'setup', 'turn_start', 'turn_token', 'turn_reset', 'turn_end', 'turn_failed',
  'checkpoint', 'await_rebuttal', 'rebuttal_received', 'verdict', 'error', 'done',
]

/**
 * Opens the debate stream with native EventSource. Each event is dispatched with its
 * SSE id as `seq` so the reducer can drop replays after an automatic reconnect.
 * Closes on `done`. Returns a cleanup function.
 *
 * EventSource retries on its own after a dropped connection, but gives up for good (readyState
 * CLOSED) when the server answers with a non-200 such as a 503 during a restart. `onClosed` fires
 * once in that case so the caller can reload the debate instead of waiting forever.
 */
export function connectDebate(
  id: string,
  dispatch: (a: DebateAction) => void,
  onClosed?: () => void,
): () => void {
  const es = new EventSource(`${API_BASE}/debates/${encodeURIComponent(id)}/stream`)
  let stopped = false
  let closedFired = false

  for (const name of EVENTS) {
    es.addEventListener(name, (e) => {
      const msg = e as MessageEvent<string>
      // `error` is also the EventSource transport-failure event; those have no data.
      if (typeof msg.data !== 'string') {
        if (name === 'error' && !stopped && !closedFired && es.readyState === CLOSED) {
          closedFired = true
          onClosed?.()
        }
        return
      }
      let data: unknown
      try { data = JSON.parse(msg.data) } catch { return }
      const seq = Number.parseInt(msg.lastEventId, 10)
      dispatch({ type: name, data, seq: Number.isNaN(seq) ? undefined : seq } as DebateAction)
      if (name === 'done') { stopped = true; es.close() }
    })
  }

  return () => { stopped = true; es.close() }
}
