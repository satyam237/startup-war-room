interface Props {
  round: number
  progress: number // 0..1
}

const ROUNDS = 3

export default function RoundIndicator({ round, progress }: Props) {
  return (
    <div className="flex items-center gap-4">
      <p className="shrink-0 font-display text-sm font-bold">
        {round > 0 ? `Round ${Math.min(round, ROUNDS)} of ${ROUNDS}` : 'Setting up'}
      </p>
      <div
        role="progressbar"
        aria-label="Debate progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
      >
        <div className="h-full bg-ink transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  )
}
