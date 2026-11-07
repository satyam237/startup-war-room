import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { m } from 'motion/react'
import { useCalm } from './useCalm'
import { useSeen } from './useSeen'

export interface Reveal {
  /** Scores and radar may start. */
  scores: boolean
  /** The verdict stamp may land. */
  stamp: boolean
  /** Risks and experiments may cascade in. */
  cascade: boolean
  /** The whole sequence is over. */
  revealed: boolean
}

const DONE: Reveal = { scores: true, stamp: true, cascade: true, revealed: true }
const RevealContext = createContext<Reveal>(DONE)

export const STAMP_AT = 2200
export const CASCADE_AT = 3000
export const REVEALED_AT = 3600

/** The verdict's staged reveal clock: scores and radar, then the stamp, then the cascade. Calm visitors get it all at once. */
export function useRevealClock(): Reveal {
  const calm = useCalm()
  const [t, setT] = useState(0)
  useEffect(() => {
    const ids = [STAMP_AT, CASCADE_AT, REVEALED_AT].map((ms, i) => window.setTimeout(() => setT(i + 1), ms))
    return () => ids.forEach(clearTimeout)
  }, [])
  if (calm) return DONE
  return { scores: true, stamp: t >= 1, cascade: t >= 2, revealed: t >= 3 }
}

export function RevealProvider({ value, children }: { value: Reveal; children: ReactNode }) {
  return <RevealContext.Provider value={value}>{children}</RevealContext.Provider>
}
export const useReveal = () => useContext(RevealContext)

/** A list row or card that slides in when it is on screen and the cascade has begun. */
export function CascadeItem({ index, as = 'li', className = '', children, ...rest }: {
  index: number
  as?: 'li' | 'div'
  className?: string
  children: ReactNode
} & Record<string, unknown>) {
  const calm = useCalm()
  const { cascade } = useReveal()
  const ref = useRef<HTMLElement>(null)
  const seen = useSeen(ref)
  const Tag = as === 'li' ? m.li : m.div
  const show = calm || (cascade && seen)
  return (
    <Tag
      ref={ref as never}
      data-cascade
      className={className}
      initial={calm ? false : { opacity: 0, x: -36, rotate: -1.2 }}
      animate={show ? { opacity: 1, x: 0, rotate: 0 } : { opacity: 0, x: -36, rotate: -1.2 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24, delay: show ? index * 0.09 : 0 }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
