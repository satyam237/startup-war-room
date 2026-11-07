import { useEffect, useLayoutEffect, useRef } from 'react'
import { animate } from 'motion/react'
import { useCalm } from './useCalm'
import { useSeen } from './useSeen'

interface Props {
  value: number
  /** Seconds to wait once the number is on screen. */
  delay?: number
  className?: string
}

/**
 * Counts 0 up to `value` the first time it is on screen. Until then the page holds the real number,
 * so a score nobody has scrolled to is still right when printed or read aloud. Calm visitors get the number at once.
 */
export default function CountUp({ value, delay = 0, className }: Props) {
  const calm = useCalm()
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useSeen(ref)

  // On screen from the start: begin at zero before the first paint, so the final number never flashes.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !calm && el.getBoundingClientRect().top < window.innerHeight) el.textContent = '0'
  }, [calm])

  useEffect(() => {
    const el = ref.current
    if (!el || calm || !seen) return
    el.textContent = '0'
    const run = animate(0, value, {
      duration: 0.7 + value * 0.07,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { el.textContent = String(Math.round(v)) },
    })
    return () => { run.stop(); el.textContent = String(value) }
  }, [calm, seen, value, delay])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const settle = () => { el.textContent = String(value) }
    window.addEventListener('beforeprint', settle)
    return () => window.removeEventListener('beforeprint', settle)
  }, [value])

  return <span ref={ref} data-score className={className}>{value}</span>
}
