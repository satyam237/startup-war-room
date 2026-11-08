import { describe, expect, it } from 'vitest'
import indexHtml from '../../index.html?raw'
import { DEFAULT_THEME, THEMES, THEME_KEY, applyTheme, getStoredTheme, initTheme, isThemeId, setTheme } from './theme'

describe('theme storage', () => {
  it('falls back to the default when nothing is stored', () => {
    expect(getStoredTheme()).toBe(DEFAULT_THEME)
  })

  it('falls back to the default when the stored value is not a known theme', () => {
    localStorage.setItem(THEME_KEY, 'chartreuse-dream')
    expect(getStoredTheme()).toBe(DEFAULT_THEME)
    expect(isThemeId('chartreuse-dream')).toBe(false)
  })

  it('applies a theme to the root element and persists it', () => {
    setTheme('nightcard')
    expect(document.documentElement.dataset.theme).toBe('nightcard')
    expect(localStorage.getItem(THEME_KEY)).toBe('nightcard')
    expect(getStoredTheme()).toBe('nightcard')
  })

  it('initTheme applies the stored theme, or the default when the stored one is invalid', () => {
    localStorage.setItem(THEME_KEY, 'courtside')
    expect(initTheme()).toBe('courtside')
    expect(document.documentElement.dataset.theme).toBe('courtside')
    localStorage.setItem(THEME_KEY, 'nope')
    expect(initTheme()).toBe(DEFAULT_THEME)
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME)
  })

  it('applyTheme alone does not persist', () => {
    applyTheme('bubblegum')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
  })

  it('ships at least three themes including a light one', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(3)
    expect(THEMES.some((t) => t.scheme === 'light')).toBe(true)
  })
})

// @ts-expect-error node typings are not installed; tests run under Node, from the frontend folder
const { readFileSync } = await import('node:fs')
const css: string = readFileSync('src/index.css', 'utf8')

/* ---- AA contrast and agent distinctness, read straight from the stylesheet ---- */

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2]
  return out
}
function themeVars(id: string): Record<string, string> {
  const base = vars(css.match(/@theme\s*\{([\s\S]*?)\n\}/)![1])
  if (id === DEFAULT_THEME) return base
  const m = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!m) throw new Error(`no css block for theme ${id}`)
  return { ...base, ...vars(m[1]) }
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const AGENTS = ['vc', 'customer', 'cto', 'competitor', 'moderator']

describe.each(THEMES.map((t) => t.id))('theme %s', (id) => {
  const v = themeVars(id)
  it('defines every token it needs', () => {
    for (const k of ['color-canvas', 'color-panel', 'color-ink', 'color-muted', 'color-on-canvas', 'color-on-canvas-muted', 'color-accent', 'color-on-accent',
      ...AGENTS.flatMap((a) => [`color-${a}`, `color-${a}-ink`])]) {
      expect(v[k], k).toBeTruthy()
    }
  })
  it('keeps body and muted text at AA on panels and on the canvas', () => {
    expect(ratio(v['color-ink'], v['color-panel'])).toBeGreaterThanOrEqual(4.5)
    expect(ratio(v['color-muted'], v['color-panel'])).toBeGreaterThanOrEqual(4.5)
    expect(ratio(v['color-on-canvas'], v['color-canvas'])).toBeGreaterThanOrEqual(4.5)
    expect(ratio(v['color-on-canvas-muted'], v['color-canvas'])).toBeGreaterThanOrEqual(4.5)
    expect(ratio(v['color-on-accent'], v['color-accent'])).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps agent names readable as text and ink readable on agent fills', () => {
    for (const a of AGENTS) {
      expect(ratio(v[`color-${a}-ink`], v['color-panel']), `${a} text on panel`).toBeGreaterThanOrEqual(4.5)
      expect(ratio(v['color-fill-ink'], v[`color-${a}`]), `${a} fill label`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('keeps the five agent colours distinct', () => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    for (let i = 0; i < AGENTS.length; i++) for (let j = i + 1; j < AGENTS.length; j++) {
      const a = rgb(v[`color-${AGENTS[i]}`]), b = rgb(v[`color-${AGENTS[j]}`])
      const d = Math.hypot(...a.map((x, k) => x - b[k]))
      expect(d, `${AGENTS[i]} vs ${AGENTS[j]}`).toBeGreaterThan(90)
    }
  })
})

// index.html applies the stored theme before the app loads, so it keeps its own copy of the ids.
describe('the pre-paint theme script', () => {
  it('index.html applies exactly the themes this module knows, before first paint', () => {
    const html = indexHtml
    const list = html.match(/\[((?:\s*'[a-z]+',?)+)\s*\]\.indexOf\(t\)/)
    expect(list, 'the inline theme script in index.html').not.toBeNull()
    const ids = [...list![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    expect(ids).toEqual(THEMES.map((t) => t.id))
  })
})
