import { useState } from 'react'
import { THEMES, getStoredTheme, setTheme, type ThemeId } from '../lib/theme'

/** Four swatches. Picking one repaints the whole page and is remembered. */
export default function ThemeSwitcher() {
  const [current, setCurrent] = useState<ThemeId>(getStoredTheme)
  return (
    <div role="radiogroup" aria-label="Colour theme" data-print="hide" className="flex items-center gap-1.5">
      {THEMES.map((t) => {
        const on = t.id === current
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={t.label}
            title={t.label}
            onClick={() => { setTheme(t.id); setCurrent(t.id) }}
            className="group relative grid size-9 place-items-center rounded-full"
          >
            <span
              aria-hidden="true"
              className="block size-7 overflow-hidden rounded-full border-[3px] transition-transform duration-150 group-hover:scale-110 group-active:scale-95"
              style={{
                borderColor: on ? 'var(--color-on-canvas)' : 'color-mix(in srgb, var(--color-on-canvas) 45%, transparent)',
                background: `conic-gradient(${t.swatch[0]} 0 33%, ${t.swatch[1]} 0 66%, ${t.swatch[2]} 0)`,
                transform: on ? 'scale(1.12)' : undefined,
              }}
            />
          </button>
        )
      })}
    </div>
  )
}
