import type { DebateState } from '../lib/debateReducer'

/** The moderator's current line: the latest checkpoint, else the latest setup step. */
export default function ModeratorBanner({ state }: { state: DebateState }) {
  const cp = state.checkpoints.at(-1)
  const setup = state.setup.at(-1)
  if (!cp && !setup) return null
  return (
    <aside data-agent="moderator" aria-label="Moderator" className="border-l-4 border-(--agent) bg-panel px-4 py-3">
      <p className="font-display text-sm font-bold text-(--agent)">Moderator</p>
      {cp ? (
        <>
          <p className="mt-1 font-body leading-snug">{cp.summary}</p>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {cp.top_disagreements.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </>
      ) : (
        <p className="mt-1 font-body leading-snug">{setup!.message}</p>
      )}
    </aside>
  )
}
