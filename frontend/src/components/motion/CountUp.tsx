import { useEffect, useRef } from 'react'
import { animate } from 'motion/react'
import { useCalm } from './useCalm'
import { useSeen } from './useSeen'

interface Props {
  value: number
  /** Seconds to wait once the number is on screen. */
  delay?: number
  /** Hold at zero until this is true (the reveal clock). */
  go?: boolean
  className?: string
}

/** Counts 0 up to `value`. The DOM always ends on the real number; calm visitors get it immediately. */
export default function CountUp({ value, delay = 0, go = true, className }: Props) {
  const calm = useCalm()
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useSeen(ref)
  const text = calm ? String(value) : '0'

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (calm) { el.textContent = String(value); return }
    if (!go || !seen) { el.textContent = '0'; return }
    const run = animate(0, value, {
      duration: 0.7 + value * 0.07,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { el.textContent = String(Math.round(v)) },
      onComplete: () => { el.textContent = String(value) },
    })
    return () => run.stop()
  }, [calm, go, seen, value, delay])

  return <span ref={ref} data-score className={className}>{text}</span>
}
