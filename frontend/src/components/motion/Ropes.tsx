import { useRef } from 'react'
import { m, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useCalm } from './useCalm'

const H = 120
const ROPES = [
  { y: 22, colour: 'var(--color-competitor)', pull: 0.55 },
  { y: 60, colour: 'var(--color-panel)', pull: 0.42 },
  { y: 98, colour: 'var(--color-cto)', pull: 0.34 },
]

function Rope({ y, colour, pull, px, py, live }: { y: number; colour: string; pull: number; px: ReturnType<typeof useSpring>; py: ReturnType<typeof useSpring>; live: boolean }) {
  const d = useTransform([px, py], ([x, ty]: number[]) => {
    const prox = live ? Math.max(0, 1 - Math.abs(ty - y) / 240) : 0
    const bend = Math.max(-34, Math.min(34, (ty - y) * pull * prox))
    return `M 0 ${y} Q ${x} ${y + bend * 2} 1000 ${y}`
  })
  return (
    <>
      <m.path d={d} fill="none" stroke="var(--color-line)" strokeWidth={14} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <m.path d={d} fill="none" stroke={colour} strokeWidth={7} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </>
  )
}

/** Three ring ropes between two posts. They bow toward the pointer and spring back. Straight when calm. */
export default function Ropes({ className = '' }: { className?: string }) {
  const calm = useCalm()
  const svgRef = useRef<SVGSVGElement>(null)
  const x = useMotionValue(500)
  const y = useMotionValue(-999)
  const spring = { stiffness: 260, damping: 11, mass: 0.7 }
  const px = useSpring(x, spring)
  const py = useSpring(y, spring)

  return (
    <div
      data-ropes
      className={`relative ${className}`}
      onPointerMove={calm ? undefined : (e) => {
        const r = svgRef.current!.getBoundingClientRect()
        x.set(((e.clientX - r.left) / r.width) * 1000)
        y.set(e.clientY - r.top)
      }}
      onPointerLeave={() => { y.set(-999); x.set(500) }}
    >
      <svg ref={svgRef} viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" className="block h-[110px] w-full overflow-visible" aria-hidden="true">
        {ROPES.map((r) => <Rope key={r.y} {...r} px={px} py={py} live={!calm} />)}
      </svg>
      <span aria-hidden="true" className="absolute -left-1 top-0 h-full w-4 rounded-sm border-[3px] border-line bg-moderator" />
      <span aria-hidden="true" className="absolute -right-1 top-0 h-full w-4 rounded-sm border-[3px] border-line bg-moderator" />
    </div>
  )
}
