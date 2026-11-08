import { m } from 'motion/react'

export const ROUND_TITLE_MS = 1700

/** Slams "ROUND N" across the screen. For calm visitors it is a plain banner that fades. */
export default function RoundTitle({ round, calm }: { round: number; calm: boolean }) {
  const sub = round === 3 ? 'Final positions' : null
  if (calm) {
    return (
      <m.div
        data-testid="round-title"
        aria-hidden="true"
        className="surface pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto w-fit bg-accent px-6 py-2 !text-on-accent"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <span className="display text-3xl">Round {round}</span>
      </m.div>
    )
  }
  return (
    <div data-testid="round-title" aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-hidden">
      <m.div
        className="w-[130%] -rotate-3 border-y-[6px] border-line bg-accent py-5 text-center text-on-accent"
        style={{ boxShadow: '0 10px 0 var(--color-shade)' }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        exit={{ scaleY: 0, opacity: 0, transition: { duration: 0.3 } }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      >
        <m.p
          className="display text-[clamp(4.5rem,17vw,12rem)] leading-[0.85]"
          initial={{ scale: 3, opacity: 0, rotate: 5 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 15, delay: 0.1 }}
        >
          Round {round}
        </m.p>
        {sub && (
          <m.p
            className="display mt-1 text-[clamp(1.4rem,4vw,2.6rem)]"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
          >
            {sub}
          </m.p>
        )}
      </m.div>
    </div>
  )
}
