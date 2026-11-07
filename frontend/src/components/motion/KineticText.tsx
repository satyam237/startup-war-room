import { useCallback, useRef } from 'react'
import { m } from 'motion/react'
import { useCalm } from './useCalm'
import { stage } from './timing'

const COLOURS = ['--color-vc', '--color-customer', '--color-cto', '--color-competitor', '--color-moderator']
const RADIUS = 120 // px around the pointer that a letter reacts within

/**
 * Display text whose letters drop in once, then leap away from the pointer and flash fighter colours.
 * Decorative: put the real sentence in an aria-label on the parent heading.
 */
export default function KineticText({ text, className = '' }: { text: string; className?: string }) {
  const calm = useCalm()
  const letters = useRef<(HTMLSpanElement | null)[]>([])
  const frame = useRef(0)
  const words = text.split(' ')
  let n = -1

  const react = useCallback((x: number, y: number) => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      // Read every letter's position first, then write: interleaving them forces a layout per letter.
      const els = letters.current
      const boxes = els.map((el) => el?.getBoundingClientRect())
      els.forEach((el, i) => {
        const r = boxes[i]
        if (!el || !r) return
        const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2))
        const k = Math.max(0, 1 - d / RADIUS)
        if (k === 0) {
          el.style.transform = ''
          el.style.color = ''
          el.style.textShadow = ''
          return
        }
        const dir = x < r.left + r.width / 2 ? 1 : -1
        el.style.transform = `translateY(${-k * 16}px) rotate(${dir * k * 9}deg) scale(${1 + k * 0.2})`
        el.style.color = k > 0.35 ? `var(${COLOURS[i % COLOURS.length]})` : ''
        el.style.textShadow = k > 0.35 ? '3px 3px 0 var(--color-line)' : ''
      })
    })
  }, [])

  const reset = useCallback(() => react(-9999, -9999), [react])

  return (
    <span
      aria-hidden="true"
      className={className}
      onPointerMove={calm ? undefined : (e) => react(e.clientX, e.clientY)}
      onPointerLeave={calm ? undefined : reset}
    >
      {words.map((word, w) => (
        <span key={w} className="inline-block whitespace-nowrap">
          {[...word].map((ch) => {
            const i = ++n
            return (
              <m.span
                key={i}
                className="inline-block"
                initial={calm ? false : { y: '70%', opacity: 0, rotate: i % 2 ? 7 : -7 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 22, delay: stage(0.15, i, calm, 0.022) }}
              >
                <span
                  ref={(el) => { letters.current[i] = el }}
                  className="inline-block"
                  style={{ transition: 'transform 0.28s cubic-bezier(.2,1.7,.4,1), color 0.15s' }}
                >
                  {ch}
                </span>
              </m.span>
            )
          })}
          {w < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  )
}
