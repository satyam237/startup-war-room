/**
 * The delay (seconds) before a staged moment starts: `base` plus `index * step`.
 * Calm visitors get no delay, so every reveal settles at once.
 */
export function stage(base: number, index: number, calm: boolean, step = 0.12): number {
  return calm ? 0 : base + index * step
}
