import { useEffect, useRef } from 'react'
import { m, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useCalm } from './useCalm'

const H = 84
const ROPES = [
  { y: 12, colour: 'var(--color-competitor)', pull: 0.55 },
  { y: 40, colour: 'var(--color-panel)', pull: 0.42 },
  { y: 68, colour: 'var(--color-cto)', pull: 0.34 },
]
const AWAY = -999

function Rope({ y, colour, pull, px, py }: { y: number; colour: string; pull: number; px: ReturnType<typeof useSpring>; py: ReturnType<typeof useSpring> }) {
  const d = useTransform([px, py], ([x, ty]: number[]) => {
    const prox = Math.max(0, 1 - Math.abs(ty - y) / 240)
    const bend = Math.max(-34, Math.min(34, (ty - y) * pull * prox))
    return `M -20 ${y} Q ${x} ${y + bend * 2} 1020 ${y}`
  })
  return (
    <>
      <m.path d={d} fill="none" stroke="var(--color-line)" strokeWidth={13} vectorEffect="non-scaling-stroke" />
      <m.path d={d} fill="none" stroke={colour} strokeWidth={7} vectorEffect="non-scaling-stroke" />
    </>
  )
}

/** Three ring ropes across the full width of the window. They bow toward the pointer and shiver once as the fighters land. */
export default function Ropes({ className = '' }: { className?: string }) {
  const calm = useCalm()
  const svgRef = useRef<SVGSVGElement>(null)
  const x = useMotionValue(500)
  const y = useMotionValue(AWAY)
  const spring = { stiffness: 260, damping: 11, mass: 0.7 }
  const px = useSpring(x, spring)
  const py = useSpring(y, spring)

  useEffect(() => {
    if (calm) return
    const move = (e: PointerEvent) => {
      const r = svgRef.current?.getBoundingClientRect()
      if (!r) return
      x.set(((e.clientX - r.left) / r.width) * 1000)
      y.set(e.clientY - r.top)
    }
    const hit = window.setTimeout(() => y.set(70), 900)
    const release = window.setTimeout(() => y.set(AWAY), 1050)
    window.addEventListener('pointermove', move, { passive: true })
    return () => { clearTimeout(hit); clearTimeout(release); window.removeEventListener('pointermove', move) }
  }, [calm, x, y])

  return (
    <div data-ropes aria-hidden="true" className={`pointer-events-none relative left-1/2 w-screen -translate-x-1/2 ${className}`}>
      <svg ref={svgRef} viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" className="block h-[84px] w-full overflow-visible">
        {ROPES.map((r) => <Rope key={r.y} {...r} px={px} py={py} />)}
      </svg>
    </div>
  )
}
