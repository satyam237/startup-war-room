import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, deleteDebate, exportUrl, getDebate, getDeleteTokens, type DebateRecord } from '../lib/api'
import type { Verdict as VerdictData } from '../lib/debateReducer'
import PanelRow from '../components/PanelRow'
import RecommendationCard from '../components/RecommendationCard'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { Radar5 } from '../components/Scorecard'
import { RevealProvider, useRevealClock } from '../components/motion/reveal'
import ExperimentList from '../components/ExperimentList'
import FeedbackBox from '../components/FeedbackBox'
import RiskList from '../components/RiskList'
import Scorecard from '../components/Scorecard'
import BroadcastReplay from '../components/voice/BroadcastReplay'
import '../print.css'

type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error'; message: string }
  | { state: 'ready'; debate: DebateRecord }

const btn = 'slab bg-panel px-4 py-2 text-sm text-ink'

export default function Verdict() {
  const { id = '' } = useParams()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const deleteToken = getDeleteTokens()[id]

  useEffect(() => {
    let live = true
    getDebate(id)
      .then((debate) => { if (live) setLoad({ state: 'ready', debate }) })
      .catch((e) => {
        if (!live) return
        if (e instanceof ApiError && e.status === 404) setLoad({ state: 'missing' })
        else setLoad({ state: 'error', message: e instanceof ApiError ? e.message : 'Could not reach the server.' })
      })
    return () => { live = false }
  }, [id])

  if (load.state === 'loading') return <main className="p-8 font-bold" aria-busy="true">Loading the verdict</main>
  if (load.state === 'missing') {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="display text-6xl">Debate not found</h1>
        <p className="mt-3 text-lg font-semibold">This link may be wrong, or the debate was deleted.</p>
        <Link to="/" className={`${btn} mt-6 inline-block`}>Start a new debate</Link>
      </main>
    )
  }
  if (load.state === 'error') {
    return <main className="mx-auto max-w-3xl px-5 py-16"><p role="alert" className="surface bg-competitor p-3 font-bold text-fill-ink">{load.message}</p></main>
  }

  const { debate } = load
  const verdict = debate.verdict
  if (!verdict && debate.status === 'failed') {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="display text-6xl">This debate failed</h1>
        <p className="mt-3 text-lg font-semibold">It stopped before the panel could reach a verdict, so there is nothing to show.</p>
        <Link to="/" className={`${btn} mt-6 inline-block`}>Start a new debate</Link>
      </main>
    )
  }
  if (!verdict) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="display text-6xl">No verdict yet</h1>
        <p className="mt-3 text-lg font-semibold">The room is still working on this one.</p>
        <Link to={`/d/${id}`} className={`${btn} mt-6 inline-block`}>Back to the room</Link>
      </main>
    )
  }
  return (
    <VerdictBody
      id={id}
      debate={debate}
      verdict={verdict}
      deleteToken={deleteToken}
      exportHref={exportUrl(id)}
      feedback={<FeedbackBox debateId={id} />}
    />
  )
}

const CALL_FILL = { go: 'var(--color-customer)', pivot: 'var(--color-vc)', no_go: 'var(--color-competitor)' }

/**
 * The verdict page proper. Controls that need the server appear only when the caller supplies them
 * (export link, feedback, delete token), so this renders anywhere a verdict exists.
 */
export function VerdictBody({ id, debate, verdict, deleteToken, exportHref, feedback }: {
  id: string
  debate: DebateRecord
  verdict: VerdictData
  deleteToken?: string
  exportHref?: string
  feedback?: ReactNode
}) {
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>(null)
  const [lit, setLit] = useState<string | null>(null)
  const reveal = useRevealClock()
  const partial = verdict.fallback || debate.status === 'budget_exceeded' || debate.status === 'partial'

  async function share() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/d/${id}/verdict`)
      setNotice('Link copied.')
    } catch {
      setNotice('Could not copy. Copy the address from the browser bar.')
    }
  }

  async function remove() {
    if (!deleteToken || !window.confirm('Delete this debate for good? The share link will stop working.')) return
    try {
      await deleteDebate(id, deleteToken)
      navigate('/')
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not delete the debate.')
    }
  }

  return (
    <RevealProvider value={reveal}>
      <main data-revealed={reveal.revealed} className="mx-auto max-w-6xl space-y-9 px-5 pb-10 pt-4">
        <header className="flex items-center justify-between gap-4" data-print="hide">
          <Link to="/" className="display whitespace-nowrap text-[1.2rem] underline-offset-4 hover:underline sm:text-3xl">Startup War Room</Link>
          <ThemeSwitcher />
        </header>

        {partial && (
          <p
            role="status"
            className="surface px-4 py-3 font-bold"
            style={{ background: 'repeating-linear-gradient(-45deg, var(--color-vc) 0 14px, var(--color-panel) 14px 28px)', color: 'var(--color-fill-ink)' }}
          >
            <span className="rounded-md bg-panel px-2 py-1 text-ink">
              Partial result. The debate ended early or the verdict used a simpler fallback, so treat these scores with extra caution.
            </span>
          </p>
        )}

        <div className="-mt-4 grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <RecommendationCard verdict={verdict} pitch={debate.pitch} />
          <Radar5 scorecard={verdict.scorecard} call={CALL_FILL[verdict.recommendation] ?? CALL_FILL.pivot} />
        </div>

        <div className="flex flex-wrap items-center gap-3" data-print="hide">
          <button type="button" className="slab bg-accent px-4 py-2 text-sm text-on-accent" onClick={() => void share()}>Share</button>
          {exportHref && <a className={btn} href={exportHref} download>Export Markdown</a>}
          <button type="button" className={btn} onClick={() => window.print()}>Print or save as PDF</button>
          <button type="button" className={btn} onClick={() => navigate('/', { state: { pitch: debate.pitch } })}>
            Run again with changes
          </button>
          {deleteToken && (
            <button type="button" className={`${btn} !bg-competitor !text-fill-ink`} onClick={() => void remove()}>Delete debate</button>
          )}
          <span role="status" className="text-sm font-bold">{notice}</span>
        </div>

        {debate.turns?.length ? <BroadcastReplay debate={debate} /> : null}

        <PanelRow risks={verdict.risks} lit={lit} onLit={setLit} />
        <Scorecard scorecard={verdict.scorecard} />
        <RiskList risks={verdict.risks} lit={lit} onLit={setLit} />
        <ExperimentList experiments={verdict.experiments} />
        {feedback}

        <p className="border-t-[3px] border-line pt-4 text-sm font-semibold">
          AI critique for brainstorming, not professional advice. Do not rely on it for legal, financial or investment decisions.
        </p>
      </main>
    </RevealProvider>
  )
}
