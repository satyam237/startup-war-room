import { useState } from 'react'
import { THEMES, getStoredTheme, setTheme, type ThemeId } from '../lib/theme'

/** Four poster colourways. Picking one repaints the whole page and is remembered. */
export default function ThemeSwitcher() {
  const [current, setCurrent] = useState<ThemeId>(getStoredTheme)
  return (
    <div className="flex shrink-0 items-center gap-2" data-print="hide">
      <span aria-hidden="true" className="hidden text-sm font-bold sm:block">{THEMES.find((t) => t.id === current)?.label}</span>
      <div role="radiogroup" aria-label="Colour theme" className="flex items-center gap-0.5 sm:gap-1">
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
              className="group grid size-8 place-items-center rounded-full sm:size-9"
            >
              <span
                aria-hidden="true"
                className={`block rounded-full border-[3px] border-(--color-on-canvas) transition-transform duration-150 group-hover:scale-110 group-active:scale-95 ${on ? 'size-7 sm:size-8' : 'size-5 sm:size-6'}`}
                style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[2]} 50%)` }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
