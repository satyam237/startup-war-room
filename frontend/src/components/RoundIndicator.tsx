import { m } from 'motion/react'
import Bell from './Bell'
import { useCalm } from './motion/useCalm'

interface Props {
  round: number
  progress: number // 0..1
  /** Finished turns per round: index 0 is round 1. Only real turns fill a tick. */
  doneByRound: number[]
  /** Rounds that have had a checkpoint. */
  checkpointRounds: number[]
}

const ROUNDS = 3
const PER_ROUND = 4 // four challengers speak each round

/** Three rounds, each a row of ticks that fill as real turns finish; a bell hangs after every checkpoint. */
export default function RoundIndicator({ round, progress, doneByRound, checkpointRounds }: Props) {
  const calm = useCalm()
  const current = Math.min(round, ROUNDS)
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <p className="display shrink-0 text-3xl">{round > 0 ? `Round ${current} of ${ROUNDS}` : 'Setting up'}</p>
      <div
        role="progressbar"
        aria-label="Debate progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="flex min-w-[16rem] flex-1 items-center gap-2"
      >
        {Array.from({ length: ROUNDS }, (_, r) => {
          const done = doneByRound[r] ?? 0
          const ticks = Math.max(PER_ROUND, done)
          return (
            <div key={r} className="flex flex-1 items-center gap-1.5">
              <div className={`flex flex-1 gap-1 rounded-md border-[3px] border-line bg-panel p-1 transition-shadow ${current === r + 1 ? 'shadow-[3px_3px_0_var(--color-shade)]' : 'opacity-80'}`}>
                {Array.from({ length: ticks }, (_, t) => {
                  const filled = t < done
                  return (
                    <span key={t} className="relative h-4 flex-1 overflow-hidden rounded-[3px] bg-panel-hi" data-filled={filled}>
                      <m.span
                        className="absolute inset-0 origin-bottom bg-accent"
                        initial={false}
                        animate={{ scaleY: filled ? 1 : 0 }}
                        transition={calm ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 18 }}
                      />
                    </span>
                  )
                })}
              </div>
              {checkpointRounds.includes(r + 1) && <Bell className="size-6 text-on-canvas" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
