import { useState, type FormEvent } from 'react'
import { m } from 'motion/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, createDebate, saveDeleteToken, type CreateDebateBody } from '../lib/api'
import { loadDebateRoom } from '../lib/routes'
import Bell from '../components/Bell'
import KineticText from '../components/motion/KineticText'
import Ropes from '../components/motion/Ropes'
import Roster from '../components/Roster'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { useCalm } from '../components/motion/useCalm'

const MIN = 50
const MAX = 2000
const MAX_META_CHARS = 200 // backend/app/routes.py

const EXAMPLES = [
  {
    label: 'Electrician app',
    pitch: 'An app that matches freelance electricians with last-minute jobs near them, with instant payouts after each job and a 12 percent fee charged to the homeowner.',
  },
  {
    label: 'AI clinic notes',
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
  const calm = useCalm()
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
  const [armed, setArmed] = useState(false) // pointer or focus is on a button that can start the debate

  const len = pitch.length
  const outgoing = questions ? withAnswers(pitch, questions, answers) : pitch
  const overBy = outgoing.length - MAX
  const valid = len >= MIN && len <= MAX && overBy <= 0
  const fill = Math.min(100, (len / MAX) * 100)

  async function send(body: CreateDebateBody) {
    setBusy(true)
    void loadDebateRoom() // ready by the time the server answers, so the hand-off shows no loading screen
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

  const field = 'field'

  const mood = busy ? 'locked' : armed && valid ? 'ready' : 'idle'
  const label = busy ? 'Entering the ring' : questions ? 'Continue to debate' : 'Start the debate'

  return (
    <main className="mx-auto max-w-7xl px-5 pb-16 pt-4">
      <header className="flex items-center justify-between gap-4">
        <p className="display whitespace-nowrap text-[1.45rem] sm:text-3xl">Startup War Room</p>
        <ThemeSwitcher />
      </header>

      <div className="mt-5 grid gap-8 lg:mt-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
        <section aria-label="The arena" className="min-w-0">
          <h1
            aria-label="Four skeptics will take your idea apart."
            className="text-[clamp(3.4rem,15.5vw,6.9rem)] lg:text-[clamp(5.2rem,8.1vw,7rem)]"
          >
            <KineticText text="Four skeptics will take your idea apart." className="display misprint block" />
          </h1>
          <p className="mt-5 max-w-xl font-body text-lg leading-relaxed">
            Pitch it in a few sentences. An investor, a customer, an engineer and a rival argue it out
            live, and a moderator hands down a verdict.
          </p>
          <Ropes className="mt-4" />
          <Roster mood={mood} />
        </section>

        <form onSubmit={onSubmit} className="surface relative z-10 space-y-4 p-5 lg:sticky lg:top-4" style={{ boxShadow: '8px 8px 0 var(--color-punch)' }}>
          <div>
            <label htmlFor="pitch" className="display mb-2 block text-3xl">Your pitch</label>
            <textarea
              id="pitch"
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              rows={5}
              disabled={busy}
              placeholder="What are you building, for whom, and how will it make money?"
              className={`${field} font-body leading-relaxed`}
            />
            <div className="mt-3 flex items-center gap-3 text-sm text-muted">
              <div className="h-3 flex-1 overflow-hidden rounded-full border-[3px] border-line bg-panel-hi" aria-hidden="true">
                <div
                  className={`h-full origin-left transition-transform duration-200 ${len > MAX ? 'bg-competitor' : valid ? 'bg-customer' : 'bg-vc'}`}
                  style={{ transform: `scaleX(${fill / 100})` }}
                />
              </div>
              <span aria-live="polite" className="shrink-0 font-semibold">
                {len < MIN ? `${MIN - len} more characters needed` : len > MAX ? `${len - MAX} over the limit` : `${len} of ${MAX}`}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Or try</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                aria-label={`Example: ${ex.label}`}
                onClick={() => setPitch(ex.pitch)}
                className="rounded border-[3px] border-line bg-panel-hi px-2.5 py-1 text-sm font-bold transition-transform hover:-translate-y-0.5 hover:rotate-[-1.5deg] hover:bg-vc active:translate-y-0 hover:text-fill-ink"
              >
                {ex.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-muted">Target user (optional)</span>
              <input className={field} maxLength={MAX_META_CHARS} value={targetUser} onChange={(e) => setTargetUser(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-muted">Pricing idea (optional)</span>
              <input className={field} maxLength={MAX_META_CHARS} value={pricing} onChange={(e) => setPricing(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-muted">Stage (optional)</span>
              <input className={field} maxLength={MAX_META_CHARS} value={stage} onChange={(e) => setStage(e.target.value)} />
            </label>
          </div>

          {questions && questions.length > 0 && (
            <m.fieldset
              data-agent="moderator"
              className="surface space-y-4 !bg-panel-hi p-4"
              initial={calm ? false : { opacity: 0, y: 16, rotate: -1 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
            >
              <legend className="display rounded-md border-[3px] border-line bg-(--agent) px-3 py-1 text-xl text-fill-ink">
                The moderator needs two more answers
              </legend>
              {questions.map((q, i) => (
                <div key={i}>
                  <label htmlFor={`q${i}`} className="mb-1 block font-semibold">{q}</label>
                  <input
                    id={`q${i}`}
                    className={field}
                    value={answers[i] ?? ''}
                    onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
                  />
                </div>
              ))}
            </m.fieldset>
          )}

          {questions && overBy > 0 && (
            <p role="status" className="rounded-md border-[3px] border-line bg-vc px-3 py-2 font-semibold text-fill-ink">
              Your pitch plus your answers is {overBy} characters over the {MAX} limit. Shorten the pitch or an answer to continue.
            </p>
          )}

          {error && (
            <m.p
              role="alert"
              className="rounded-md border-[3px] border-line bg-competitor px-3 py-2 font-semibold text-fill-ink"
              initial={calm ? false : { x: -10 }}
              animate={{ x: [-10, 8, -6, 4, 0] }}
              transition={{ duration: 0.4 }}
            >
              {error}
            </m.p>
          )}

          <button
            type="submit"
            disabled={!valid || busy}
            aria-busy={busy}
            onPointerEnter={() => setArmed(true)}
            onPointerLeave={() => setArmed(false)}
            onFocus={() => setArmed(true)}
            onBlur={() => setArmed(false)}
            className={`slab group relative w-full overflow-hidden bg-accent px-6 py-3.5 text-xl text-on-accent ${valid && !calm ? 'armed-pop' : ''}`}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/4 -skew-x-12 bg-white/35 transition-transform duration-700 ease-out group-hover:translate-x-[550%] group-disabled:hidden"
            />
            <span className="relative flex items-center justify-center gap-3">
              {(busy || valid) && <Bell ringing={busy && !calm} className="size-6 transition-transform group-hover:rotate-12" />}
              <span className={`transition-[letter-spacing] duration-300 ${busy ? '' : 'group-hover:tracking-[0.06em]'}`}>{label}</span>
            </span>
          </button>

          {busy && (
            <div role="status" aria-label="Sending your pitch" className="-mt-2 space-y-2">
              <div className="relative h-2.5 overflow-hidden rounded-full border-[3px] border-line bg-panel-hi">
                <div className="sweep absolute inset-y-0 left-0 w-1/3 bg-competitor" />
              </div>
              <p className="text-sm font-semibold text-muted">Checking your pitch, then opening the room.</p>
            </div>
          )}

          <p className="text-xs leading-relaxed text-muted">
            Do not paste confidential or proprietary information. Debates are reachable by anyone with the link.
            The critique is AI brainstorming, not professional advice.
          </p>
        </form>
      </div>
    </main>
  )
}
