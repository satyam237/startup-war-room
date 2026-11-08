/**
 * How many voice pages (debate room, verdict) are on screen. The HD engine lets its worker and model go
 * shortly after the last one closes. Tiny and dependency-free, so pages can report in without loading HD code.
 */
let count = 0
const watchers = new Set<(n: number) => void>()

/** Call on mount; call the returned function on unmount. */
export function enterVoicePage(): () => void {
  count += 1
  watchers.forEach((fn) => fn(count))
  let left = false
  return () => {
    if (left) return
    left = true
    count -= 1
    watchers.forEach((fn) => fn(count))
  }
}

export function voicePageCount(): number {
  return count
}

export function watchVoicePages(fn: (n: number) => void): () => void {
  watchers.add(fn)
  return () => { watchers.delete(fn) }
}
