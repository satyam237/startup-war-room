import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, submitRebuttal } from '../lib/api'

const MAX = 500

interface Props {
  debateId: string
  timeoutS: number
  /** Called when the window is over for this box (sent, skipped, or closed by the server). */
  onClosed: (note?: string) => void
}

export default function RebuttalBox({ debateId, timeoutS, onClosed }: Props) {
  const [text, setText] = useState('')
  const [left, setLeft] = useState(timeoutS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  async function send(body: string) {
    setBusy(true)
    setError(null)
    try {
      await submitRebuttal(debateId, body)
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

  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t-2 border-ink bg-panel-hi px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="rebuttal" className="font-display font-bold">Your rebuttal</label>
        <span className="text-sm text-muted" role="timer" aria-live="off">
          {left > 0 ? `${left}s left` : 'Time is up'}
        </span>
      </div>
      <p className="text-sm text-muted">The room has paused. Answer the sharpest point, or let them carry on.</p>
      <textarea
        id="rebuttal"
        value={text}
        maxLength={MAX}
        rows={3}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-sm border border-line bg-bunker px-3 py-2 font-body"
      />
      {error && <p role="alert" className="text-sm text-competitor">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-sm bg-ink px-4 py-2 font-bold text-bunker hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send rebuttal
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send('')}
          className="rounded-sm border border-line px-4 py-2 hover:border-ink disabled:opacity-40"
        >
          Skip
        </button>
        <span className="ml-auto text-xs text-muted">{text.length} of {MAX}</span>
      </div>
    </form>
  )
}
