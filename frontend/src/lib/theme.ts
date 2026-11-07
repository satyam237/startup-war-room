/**
 * Themes are plain CSS-variable sets in index.css, selected by `data-theme` on <html>.
 * This module only knows the ids, which one is current, and where it is remembered.
 */
export type ThemeId = 'ringside' | 'nightcard' | 'courtside' | 'bubblegum'

export interface ThemeInfo {
  id: ThemeId
  label: string
  scheme: 'light' | 'dark'
  /** Three swatches for the picker: canvas, panel, signature. Display only; the real colours live in the CSS. */
  swatch: [string, string, string]
}

export const THEMES: readonly ThemeInfo[] = [
  { id: 'ringside', label: 'Ringside', scheme: 'light', swatch: ['#FFD93D', '#FFFFFF', '#FF3D6E'] },
  { id: 'nightcard', label: 'Night Card', scheme: 'dark', swatch: ['#120D2B', '#1D1740', '#7B6CF0'] },
  { id: 'courtside', label: 'Courtside', scheme: 'light', swatch: ['#2457FF', '#FFFFFF', '#FFE14A'] },
  { id: 'bubblegum', label: 'Bubblegum', scheme: 'light', swatch: ['#FF9ED8', '#FFFFFF', '#7B2CFF'] },
]

export const DEFAULT_THEME: ThemeId = 'ringside'
export const THEME_KEY = 'swr.theme'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value)
}

export function getStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return isThemeId(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME // storage can be blocked (private mode, strict settings)
  }
}

/** Puts a theme on the page without remembering it. */
export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id
}

/** Applies and remembers a theme. */
export function setTheme(id: ThemeId): void {
  applyTheme(id)
  try { localStorage.setItem(THEME_KEY, id) } catch { /* the choice just will not survive a reload */ }
}

/** Applies whatever is stored, or the default. Returns what it applied. */
export function initTheme(): ThemeId {
  const id = getStoredTheme()
  applyTheme(id)
  return id
}
