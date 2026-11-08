import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { HD_DOWNLOAD_MB } from '../../lib/voice/cast'
import type { HdStatus } from '../../lib/voice/hdEngine'
import type { VoiceRole } from '../../lib/voice/types'
import FighterGlyph from '../FighterGlyph'

/** A segmented radio group in slab style. One tab stop; arrow keys move and pick, like the theme switcher. */
export function Segmented<T extends string>({ label, options, value, onPick }: {
  label: string
  options: { value: T; label: string; disabled?: boolean; title?: string }[]
  value: T
  onPick: (v: T) => void
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const focusable = options.some((o) => o.value === value && !o.disabled) ? value : options[enabled[0] ?? 0]?.value

  function onKeyDown(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step || !enabled.length) return
    e.preventDefault()
    const at = enabled.indexOf(i)
    const next = enabled[(at + step + enabled.length) % enabled.length]
    onPick(options[next].value)
    buttons.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded border-[3px] border-line bg-panel shadow-[3px_3px_0_var(--color-shade)]">
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => { buttons.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            title={o.title}
            tabIndex={o.value === focusable ? 0 : -1}
            onClick={() => onPick(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`min-h-9 px-2.5 text-sm font-extrabold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${i > 0 ? 'border-l-[3px] border-line' : ''} ${on ? 'bg-accent text-on-accent' : 'text-ink hover:bg-panel-hi'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** The ring's on-air light. Lit in the speaker's colour while a voice is talking. */
export function OnAir({ on, role, who }: { on: boolean; role: VoiceRole | null; who?: string }) {
  const agent = role === 'founder' ? 'moderator' : role
  return (
    <span
      aria-label="Now speaking"
      data-agent={agent ?? undefined}
      className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded border-[3px] border-line px-2 text-sm font-extrabold ${on ? 'bg-(--agent) text-fill-ink' : 'bg-panel-hi text-muted'}`}
      style={on ? { boxShadow: '0 0 0 3px var(--color-panel), 0 0 0 6px var(--agent)' } : undefined}
    >
      {on && agent ? (
        <>
          {role === 'founder'
            ? <span aria-hidden="true" className="grid size-5 place-items-center rounded-full border-[3px] border-line bg-panel" />
            : <FighterGlyph agent={agent} className="size-5" />}
          {who}
          <span className="eq" aria-hidden="true"><i /><i /><i /><i /></span>
        </>
      ) : (
        <><span aria-hidden="true" className="size-3 rounded-full border-[3px] border-line bg-panel" />Off air</>
      )}
    </span>
  )
}

/** The one-time download notice. Nothing downloads until the listener agrees. */
export function HdConsent({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  return (
    <div role="group" aria-label="HD voices download" className="w-full rounded border-[3px] border-dashed border-line bg-panel-hi px-3 py-2.5">
      <p className="font-body text-sm leading-relaxed">
        HD voices are a one-time {HD_DOWNLOAD_MB} MB download. Your browser keeps the files for next time,
        and the voices run on this device, so the debate text never leaves it.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={onAccept} className="slab bg-accent px-3 py-1 text-sm text-on-accent">Download HD voices ({HD_DOWNLOAD_MB} MB)</button>
        <button type="button" onClick={onDecline} className="slab bg-panel px-3 py-1 text-sm text-ink">Not now</button>
      </div>
    </div>
  )
}

/** Download progress for the HD model, shown only while it loads. */
export function HdLoading({ hd }: { hd: HdStatus }) {
  if (hd.state !== 'loading') return null
  const pct = Math.round(hd.progress * 100)
  return (
    <span className="inline-flex items-center gap-2 text-sm font-bold">
      Loading HD voices
      <span
        role="progressbar"
        aria-label="HD voice download"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="relative block h-3 w-24 overflow-hidden rounded-sm border-[3px] border-line bg-panel-hi"
      >
        <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  )
}

/** One caption: the speaker, then the line with the chunk being spoken in strong ink. */
export function CaptionText({ chunks, current }: { chunks: string[]; current: number }): ReactNode {
  return chunks.map((c, i) => (
    <span key={i} className={i === current ? 'font-semibold text-ink' : 'text-muted'}>{i ? ' ' : ''}{c}</span>
  ))
}
