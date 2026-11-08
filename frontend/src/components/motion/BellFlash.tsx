import { m } from 'motion/react'
import Bell from '../Bell'

export const BELL_FLASH_MS = 1500

/** A big bell that pops up mid-screen when a round ends. Decorative; the checkpoint text carries the news. */
export default function BellFlash() {
  return (
    <m.div
      data-testid="bell-flash"
      aria-hidden="true"
      className="pointer-events-none fixed left-1/2 top-[28%] z-40 -translate-x-1/2 text-fill-ink"
      initial={{ scale: 0.2, opacity: 0, y: 40 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 1.6, opacity: 0, transition: { duration: 0.35 } }}
      transition={{ type: 'spring', stiffness: 450, damping: 14 }}
    >
      <span
        data-agent="moderator"
        className="grid size-36 place-items-center rounded-full border-[5px] border-line bg-(--agent)"
        style={{ boxShadow: '8px 8px 0 var(--color-shade)' }}
      >
        <Bell ringing className="size-24" />
      </span>
    </m.div>
  )
}
