import { useEffect, useState, type RefObject } from 'react'

/** True once the element has been on screen. Without IntersectionObserver (old browsers, tests) it counts as seen. */
export function useSeen(ref: RefObject<Element | null>, margin = '-8% 0px'): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (seen || !el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect() }
    }, { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, seen, margin])
  return seen
}
