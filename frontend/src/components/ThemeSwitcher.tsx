import { useRef, useState, type KeyboardEvent } from 'react'
import { THEMES, getStoredTheme, setTheme, type ThemeId } from '../lib/theme'

/** Four poster colourways. Picking one repaints the whole page and is remembered. One tab stop; arrows move. */
export default function ThemeSwitcher() {
  const [current, setCurrent] = useState<ThemeId>(getStoredTheme)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const pick = (id: ThemeId) => { setTheme(id); setCurrent(id) }

  function onKeyDown(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + THEMES.length) % THEMES.length
    pick(THEMES[next].id)
    buttons.current[next]?.focus()
  }

  return (
    <div className="flex shrink-0 items-center gap-1" data-print="hide">
      <span aria-hidden="true" className="hidden text-sm font-bold sm:block">{THEMES.find((t) => t.id === current)?.label}</span>
      <div role="radiogroup" aria-label="Colour theme" className="-mr-1.5 flex items-center">
        {THEMES.map((t, i) => {
          const on = t.id === current
          return (
            <button
              key={t.id}
              ref={(el) => { buttons.current[i] = el }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t.label}
              title={t.label}
              tabIndex={on ? 0 : -1}
              onClick={() => pick(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className="group grid size-11 place-items-center rounded-full"
            >
              <span
                aria-hidden="true"
                className={`block rounded-full border-[3px] border-(--color-on-canvas) transition-transform duration-150 group-hover:scale-110 group-active:scale-95 ${on ? 'size-8' : 'size-6'}`}
                style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[2]} 50%)` }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
