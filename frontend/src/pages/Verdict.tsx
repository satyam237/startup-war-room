import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, deleteDebate, exportUrl, getDebate, getDeleteTokens, type DebateRecord } from '../lib/api'
import ExperimentList from '../components/ExperimentList'
import FeedbackBox from '../components/FeedbackBox'
import RecommendationCard from '../components/RecommendationCard'
import RiskList from '../components/RiskList'
import Scorecard from '../components/Scorecard'
import '../print.css'

type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error'; message: string }
  | { state: 'ready'; debate: DebateRecord }

const btn = 'rounded-sm border border-line px-4 py-2 text-sm font-semibold hover:border-ink'

export default function Verdict() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
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

  if (load.state === 'loading') return <main className="p-8 text-muted" aria-busy="true">Loading the verdict</main>
  if (load.state === 'missing') {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="font-display text-4xl font-black">Debate not found</h1>
        <p className="mt-3 text-muted">This link may be wrong, or the debate was deleted.</p>
        <Link to="/" className={`${btn} mt-6 inline-block`}>Start a new debate</Link>
      </main>
    )
  }
  if (load.state === 'error') {
    return <main className="mx-auto max-w-3xl px-5 py-16"><p role="alert" className="text-competitor">{load.message}</p></main>
  }

  const { debate } = load
  const verdict = debate.verdict
  if (!verdict && debate.status === 'failed') {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="font-display text-4xl font-black">This debate failed</h1>
        <p className="mt-3 text-muted">It stopped before the panel could reach a verdict, so there is nothing to show.</p>
        <Link to="/" className={`${btn} mt-6 inline-block`}>Start a new debate</Link>
      </main>
    )
  }
  if (!verdict) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="font-display text-4xl font-black">No verdict yet</h1>
        <p className="mt-3 text-muted">The room is still working on this one.</p>
        <Link to={`/d/${id}`} className={`${btn} mt-6 inline-block`}>Back to the room</Link>
      </main>
    )
  }

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
    <main className="mx-auto max-w-5xl space-y-12 px-5 py-10 sm:py-14">
      {partial && (
        <p role="status" className="rounded-sm border border-vc/70 bg-vc/10 px-3 py-2 text-vc">
          Partial result. The debate ended early or the verdict used a simpler fallback, so treat these scores with extra caution.
        </p>
      )}

      <RecommendationCard verdict={verdict} />

      <div className="flex flex-wrap items-center gap-2" data-print="hide">
        <button type="button" className={btn} onClick={() => void share()}>Share</button>
        <a className={btn} href={exportUrl(id)} download>Export Markdown</a>
        <button type="button" className={btn} onClick={() => window.print()}>Print or save as PDF</button>
        <button type="button" className={btn} onClick={() => navigate('/', { state: { pitch: debate.pitch } })}>
          Run again with changes
        </button>
        {deleteToken && (
          <button type="button" className={`${btn} text-competitor`} onClick={() => void remove()}>Delete debate</button>
        )}
        <span role="status" className="text-sm text-muted">{notice}</span>
      </div>

      <Scorecard scorecard={verdict.scorecard} />
      <RiskList risks={verdict.risks} />
      <ExperimentList experiments={verdict.experiments} />
      <FeedbackBox debateId={id} />

      <p className="border-t border-line pt-4 text-sm text-muted">
        AI critique for brainstorming, not professional advice. Do not rely on it for legal, financial or investment decisions.
      </p>
    </main>
  )
}
