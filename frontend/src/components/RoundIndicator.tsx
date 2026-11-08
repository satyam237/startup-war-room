import { m } from 'motion/react'
import type { AgentId } from '../lib/debateReducer'
import Bell from './Bell'
import { useCalm } from './motion/useCalm'

interface Props {
  round: number
  progress: number // 0..1
  /** Who finished a turn in each round, in order: index 0 is round 1. Only real turns fill a tick. */
  turnsByRound: AgentId[][]
  /** Rounds that have had a checkpoint. */
  checkpointRounds: number[]
}

const ROUNDS = 3
const PER_ROUND = 4 // four challengers speak each round

/** Three rounds, each a row of ticks that fill in the speaker's colour as real turns finish; a bell hangs after every checkpoint. */
export default function RoundIndicator({ round, progress, turnsByRound, checkpointRounds }: Props) {
  const calm = useCalm()
  const current = Math.min(round, ROUNDS)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <p className="display shrink-0 text-2xl sm:text-3xl">{round > 0 ? `Round ${current} of ${ROUNDS}` : 'Setting up'}</p>
      <div
        role="progressbar"
        aria-label="Debate progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="flex min-w-[11rem] flex-1 items-center gap-1 sm:min-w-[16rem] sm:gap-2"
      >
        {Array.from({ length: ROUNDS }, (_, r) => {
          const spoke = turnsByRound[r] ?? []
          const ticks = Math.max(PER_ROUND, spoke.length)
          return (
            <div key={r} className="flex flex-1 items-center gap-1.5">
              <div className={`flex flex-1 gap-0.5 rounded border-[3px] sm:gap-1 border-line bg-panel p-0.5 sm:p-1 ${current === r + 1 ? 'shadow-[3px_3px_0_var(--color-shade)]' : ''}`}>
                {Array.from({ length: ticks }, (_, t) => {
                  const who = spoke[t]
                  return (
                    <span key={t} data-agent={who} className="relative h-4 flex-1 overflow-hidden rounded-[2px] bg-panel-hi" data-filled={who !== undefined}>
                      <m.span
                        className="absolute inset-0 origin-bottom border border-line bg-(--agent,var(--color-accent)) sm:border-2"
                        initial={false}
                        animate={{ scaleY: who ? 1 : 0 }}
                        transition={calm ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 18 }}
                      />
                    </span>
                  )
                })}
              </div>
              {checkpointRounds.includes(r + 1) && <Bell className="size-5 text-on-canvas sm:size-6" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
