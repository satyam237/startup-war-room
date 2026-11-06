import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, createDebate, saveDeleteToken, type CreateDebateBody } from '../lib/api'
import { AGENTS } from '../lib/debateReducer'

const MIN = 50
const MAX = 2000

const SEATS: Record<(typeof AGENTS)[number], string> = {
  vc: 'Investor',
  customer: 'Customer',
  cto: 'Engineer',
  competitor: 'Rival',
  moderator: 'Moderator',
}

const EXAMPLES = [
  {
    label: 'Electrician marketplace',
    pitch: 'An app that matches freelance electricians with last-minute jobs near them, with instant payouts after each job and a 12 percent fee charged to the homeowner.',
  },
  {
    label: 'AI meeting notes for clinics',
    pitch: 'Ambient AI that listens to doctor-patient visits in small clinics, writes the visit note, and files it into the clinic software. Priced at 60 dollars per doctor per month.',
  },
  {
    label: 'Rent-a-tool lockers',
    pitch: 'Smart lockers in apartment lobbies that rent out drills, ladders and other tools by the hour, so residents never buy a tool they use twice a year.',
  },
]

/** Appends the answers whole; the caller must keep the result within MAX (never truncated here). */
function withAnswers(pitch: string, questions: string[], answers: string[]): string {
  const extra = questions
    .map((q, i) => (answers[i]?.trim() ? `Q: ${q}\nA: ${answers[i].trim()}` : ''))
    .filter(Boolean)
    .join('\n')
  return extra ? `${pitch}\n\nClarifications:\n${extra}` : pitch
}

export default function Pitch() {
  const navigate = useNavigate()
  const location = useLocation()
  const [pitch, setPitch] = useState<string>((location.state as { pitch?: string } | null)?.pitch ?? '')
  const [targetUser, setTargetUser] = useState('')
  const [pricing, setPricing] = useState('')
  const [stage, setStage] = useState('')
  const [questions, setQuestions] = useState<string[] | null>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const len = pitch.length
  const outgoing = questions ? withAnswers(pitch, questions, answers) : pitch
  const overBy = outgoing.length - MAX
  const valid = len >= MIN && len <= MAX && overBy <= 0
  const fill = Math.min(100, (len / MAX) * 100)

  async function send(body: CreateDebateBody) {
    setBusy(true)
    setError(null)
    try {
      const res = await createDebate(body)
      if (res.kind === 'needs_clarification') {
        setQuestions(res.questions)
        setAnswers(res.questions.map(() => ''))
      } else {
        saveDeleteToken(res.debateId, res.deleteToken)
        navigate(`/d/${res.debateId}`)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    if (questions) {
      void send({ ...meta(), pitch: outgoing, skip_clarify: true })
    } else {
      void send({ ...meta(), pitch })
    }
  }

  function meta(): Partial<CreateDebateBody> {
    return {
      ...(targetUser.trim() && { target_user: targetUser.trim() }),
      ...(pricing.trim() && { pricing: pricing.trim() }),
      ...(stage.trim() && { stage: stage.trim() }),
    }
  }

  const field = 'w-full rounded-sm border border-line bg-bunker px-3 py-2 text-ink placeholder:text-muted/70'

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:py-16">
      <ul className="mb-8 flex items-end gap-2" aria-label="Who is in the room">
        {AGENTS.map((a, i) => (
          <li key={a} data-agent={a} className="flex flex-col gap-1.5" style={{ flex: a === 'moderator' ? 0.7 : 1 }}>
            <span className="seat block h-8 rounded-t-sm bg-(--agent)" style={{ animationDelay: `${i * 110}ms` }} />
            <span className="text-xs text-muted">{SEATS[a]}</span>
          </li>
        ))}
      </ul>

      <h1 className="font-display text-5xl font-black leading-[0.95] tracking-tight [font-stretch:75%] sm:text-7xl">
        Four skeptics will take your idea apart.
      </h1>
      <p className="mt-5 max-w-xl font-body text-lg leading-relaxed text-muted">
        Pitch it in a few sentences. An investor, a customer, an engineer and a rival argue it out
        live, and a moderator hands down a verdict.
      </p>

      <form onSubmit={onSubmit} className="mt-10 space-y-5">
        <div>
          <label htmlFor="pitch" className="mb-2 block font-semibold">Your pitch</label>
          <textarea
            id="pitch"
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            rows={7}
            disabled={busy}
            placeholder="What are you building, for whom, and how will it make money?"
            className={`${field} font-body leading-relaxed`}
          />
          <div className="mt-2 flex items-center gap-3 text-sm text-muted">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div
                className={`h-full transition-[width] ${len > MAX ? 'bg-competitor' : valid ? 'bg-customer' : 'bg-vc'}`}
                style={{ width: `${fill}%` }}
              />
            </div>
            <span aria-live="polite">
              {len < MIN ? `${MIN - len} more characters needed` : len > MAX ? `${len - MAX} over the limit` : `${len} of ${MAX}`}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">No idea handy? Try one.</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              aria-label={`Example: ${ex.label}`}
              onClick={() => setPitch(ex.pitch)}
              className="rounded-full border border-line px-3 py-1 text-sm hover:border-ink"
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Target user (optional)</span>
            <input className={field} value={targetUser} onChange={(e) => setTargetUser(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Pricing idea (optional)</span>
            <input className={field} value={pricing} onChange={(e) => setPricing(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Stage (optional)</span>
            <input className={field} value={stage} onChange={(e) => setStage(e.target.value)} />
          </label>
        </div>

        {questions && questions.length > 0 && (
          <fieldset className="space-y-4 rounded-sm border border-moderator/60 bg-panel p-4" data-agent="moderator">
            <legend className="px-2 font-semibold text-(--agent)">The moderator needs two more answers</legend>
            {questions.map((q, i) => (
              <div key={q}>
                <label htmlFor={`q${i}`} className="mb-1 block">{q}</label>
                <input
                  id={`q${i}`}
                  className={field}
                  value={answers[i] ?? ''}
                  onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
                />
              </div>
            ))}
          </fieldset>
        )}

        {questions && overBy > 0 && (
          <p role="status" className="rounded-sm border border-vc/70 bg-vc/10 px-3 py-2 text-vc">
            Your pitch plus your answers is {overBy} characters over the {MAX} limit. Shorten the pitch or an answer to continue.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-sm border border-competitor/70 bg-competitor/10 px-3 py-2 text-competitor">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!valid || busy}
          className="rounded-sm bg-ink px-6 py-3 font-bold text-bunker hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Opening the room' : questions ? 'Continue to debate' : 'Start the debate'}
        </button>

        <p className="text-sm text-muted">
          Do not paste confidential or proprietary information. Debates are reachable by anyone with the link.
          The critique is AI brainstorming, not professional advice.
        </p>
      </form>
    </main>
  )
}
