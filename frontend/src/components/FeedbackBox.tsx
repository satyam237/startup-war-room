import { useState } from 'react'
import { ApiError, sendFeedback } from '../lib/api'

export default function FeedbackBox({ debateId }: { debateId: string }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (done) return <p role="status" className="text-muted print:hidden">Thanks for the feedback.</p>

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await sendFeedback(debateId, rating, comment.trim() || undefined)
      setDone(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send feedback. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="fb-h" className="print:hidden">
      <h2 id="fb-h" className="font-display text-2xl font-bold">Was this useful?</h2>
      <div role="radiogroup" aria-label="Rating" className="mt-3 flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} of 5`}
            onClick={() => setRating(n)}
            className={`size-10 rounded-sm border font-bold ${rating === n ? 'border-ink bg-ink text-bunker' : 'border-line hover:border-ink'}`}
          >
            {n}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-muted">Comment (optional)</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={1000}
          className="w-full max-w-lg rounded-sm border border-line bg-bunker px-3 py-2 text-ink"
        />
      </label>
      {error && <p role="alert" className="mt-2 text-competitor">{error}</p>}
      <button
        type="button"
        disabled={rating === 0 || busy}
        onClick={() => void submit()}
        className="mt-3 rounded-sm bg-ink px-5 py-2 font-bold text-bunker disabled:cursor-not-allowed disabled:opacity-40"
      >
        Send feedback
      </button>
    </section>
  )
}
