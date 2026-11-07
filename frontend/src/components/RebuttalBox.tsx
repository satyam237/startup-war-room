import { useEffect, useState, type FormEvent } from 'react'
import { m } from 'motion/react'
import { ApiError, submitRebuttal } from '../lib/api'
import { useCalm } from './motion/useCalm'

const MAX = 500

interface Props {
  debateId: string
  timeoutS: number
  /** Called when the window is over for this box (sent, skipped, or closed by the server). */
  onClosed: (note?: string) => void
  /** Sends the rebuttal. Defaults to the real API; the demo room swaps it out. */
  send?: (text: string) => Promise<void>
}

export type Pressure = 'calm' | 'rising' | 'critical'

/** How hot the window is. Based on the real seconds left: calm above half, rising below, critical in the last five. */
export function pressureFor(left: number, total: number): Pressure {
  if (total <= 0) return 'calm'
  if (left <= 5 || left / total <= 0.15) return 'critical'
  if (left / total <= 0.5) return 'rising'
  return 'calm'
}

export default function RebuttalBox({ debateId, timeoutS, onClosed, send: sendRebuttal }: Props) {
  const calm = useCalm()
  const [text, setText] = useState('')
  const [left, setLeft] = useState(timeoutS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pressure = pressureFor(left, timeoutS)

  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  async function send(body: string) {
    setBusy(true)
    setError(null)
    try {
      await (sendRebuttal ? sendRebuttal(body) : submitRebuttal(debateId, body))
      onClosed()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        onClosed('The rebuttal window had already closed, so the debate carried on without a note from you.')
      } else {
        setError('Could not send that. Try again, or skip.')
        setBusy(false)
      }
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (text.trim() && !busy) void send(text.trim())
  }

  const hot = pressure === 'critical' ? 'var(--color-competitor)' : pressure === 'rising' ? 'var(--color-vc)' : 'var(--color-customer)'

  return (
    <>
      {/* Red creeps in from the edges of the screen as the clock runs down. */}
      <m.div
        aria-hidden="true"
        data-print="hide"
        className="pointer-events-none fixed inset-0 z-30"
        style={{ background: 'radial-gradient(ellipse at center, transparent 52%, var(--color-competitor) 135%)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: pressure === 'critical' ? 0.5 : pressure === 'rising' ? 0.2 : 0 }}
        transition={{ duration: 0.6 }}
      />
      <m.form
        onSubmit={onSubmit}
        data-pressure={pressure}
        data-agent="moderator"
        className="relative z-40 mt-3"
        initial={calm ? false : { y: 60, opacity: 0, scale: 0.92 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 20 }}
      >
        <div className="beat surface space-y-3 px-4 pb-4 pt-3" style={{ boxShadow: `6px 6px 0 ${hot}` }}>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="rebuttal" className="display text-2xl">Your rebuttal</label>
            <span role="timer" aria-live="off" className="display rounded-md border-[3px] border-line px-2.5 py-1 text-2xl text-fill-ink transition-colors duration-300" style={{ background: hot }}>
              <span key={left} className="tick-pop inline-block">{left > 0 ? `${left}s left` : 'Time is up'}</span>
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full border-[3px] border-line bg-panel-hi" aria-hidden="true">
            <div
              className="h-full origin-left transition-[transform,background-color] duration-1000 ease-linear"
              style={{ transform: `scaleX(${timeoutS > 0 ? left / timeoutS : 0})`, background: hot }}
            />
          </div>
          <p className="text-sm font-semibold text-muted">The room has paused. Answer the sharpest point, or let them carry on.</p>
          <textarea
            id="rebuttal"
            value={text}
            maxLength={MAX}
            rows={3}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            className="field font-body"
          />
          {error && <p role="alert" className="text-sm font-bold text-competitor-ink">{error}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || !text.trim()} className="slab bg-accent px-4 py-2 text-on-accent">
              Send rebuttal
            </button>
            <button type="button" disabled={busy} onClick={() => void send('')} className="slab bg-panel px-4 py-2 text-ink">
              Skip
            </button>
            <span className="ml-auto text-xs font-semibold text-muted">{text.length} of {MAX}</span>
          </div>
        </div>
      </m.form>
    </>
  )
}
