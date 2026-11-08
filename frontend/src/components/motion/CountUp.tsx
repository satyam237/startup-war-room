import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
 * Counts 0 up to `value` the first time it is on screen. Until then the page shows the real number, so a score
 * nobody has scrolled to is still right when printed. The counting digits are hidden from assistive tech, which
 * reads one stable value instead. Calm visitors get the number at once.
 */
export default function CountUp({ value, delay = 0, className }: Props) {
  const calm = useCalm()
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useSeen(ref)
  const [shown, setShown] = useState(value)
  const printing = useRef(false)
  const run = useRef<ReturnType<typeof animate> | null>(null)

  // On screen from the start: begin at zero before the first paint, so the final number never flashes.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !calm && el.getBoundingClientRect().top < window.innerHeight) setShown(0)
  }, [calm])

  useEffect(() => {
    if (calm || printing.current) { setShown(value); return }
    if (!seen) return // keeps the real number, or the zero it starts from when on screen
    setShown(0)
    run.current = animate(0, value, {
      duration: 0.7 + value * 0.07,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    })
    return () => { run.current?.stop(); setShown(value) }
  }, [calm, seen, value, delay])

  useEffect(() => {
    const settle = () => { printing.current = true; run.current?.stop(); setShown(value) }
    window.addEventListener('beforeprint', settle)
    return () => window.removeEventListener('beforeprint', settle)
  }, [value])

  return (
    <>
      <span className="sr-only">{value}</span>
      <span ref={ref} aria-hidden="true" data-score className={className}>{shown}</span>
    </>
  )
}
