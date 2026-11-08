import { useEffect, useMemo, useRef, useState } from 'react'
import type { DebateRecord } from '../../lib/api'
import { replayScript } from '../../lib/voice/script'
import { hasHdConsent, rememberHdConsent } from '../../lib/voice/preference'
import { useCalm } from '../motion/useCalm'
import { CaptionText, HdConsent, HdLoading, OnAir, Segmented } from './VoiceControls'
import { useBroadcast } from './useBroadcast'

const SPEEDS = [1, 1.25, 1.5] as const
type Speed = `${(typeof SPEEDS)[number]}`

const icon = 'size-4 shrink-0'
const PlayIcon = () => <svg viewBox="0 0 16 16" className={icon} aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
const PauseIcon = () => <svg viewBox="0 0 16 16" className={icon} aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor" /></svg>
const SkipIcon = ({ back }: { back?: boolean }) => (
  <svg viewBox="0 0 16 16" className={`${icon} ${back ? '-scale-x-100' : ''}`} aria-hidden="true"><path d="M2.5 2.5v11l7.5-5.5zM11 2.5h2.5v11H11z" fill="currentColor" /></svg>
)

/**
 * Replay as broadcast: the whole stored debate read aloud, announcer first, verdict last.
 * Works for anyone holding the share link, since it needs only GET /debates/{id}.
 */
export default function BroadcastReplay({ debate }: { debate: DebateRecord }) {
  const lines = useMemo(() => replayScript(debate), [debate])
  const b = useBroadcast(lines, false)
  const calm = useCalm()
  const [asking, setAsking] = useState(false)
  const list = useRef<HTMLOListElement>(null)
  const items = useRef<(HTMLLIElement | null)[]>([])
  const { status, index, chunk, chunks, rate } = b.snap
  const active = status === 'playing' || status === 'paused'

  // Keep the current caption in view inside the list, without scrolling the page under the reader.
  useEffect(() => {
    const el = items.current[index]
    const box = list.current
    if (!active || !el || !box) return
    const top = Math.max(0, el.offsetTop - 8) // the list is position: relative, so offsetTop is measured from its top
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo?.({ top, behavior: calm ? 'auto' : 'smooth' })
    }
  }, [index, active, calm])

  function playFrom(at?: number) {
    if (b.pref === 'off') b.remember('instant')
    void b.start(b.engine, at ?? (status === 'ended' ? 0 : undefined))
  }

  function transport() {
    if (status === 'playing') b.pause()
    else if (status === 'paused') b.resume()
    else playFrom()
  }

  function pickVoice(v: 'instant' | 'hd') {
    if (v === 'hd' && !hasHdConsent()) { setAsking(true); return }
    setAsking(false)
    b.choose(v, false)
  }

  const line = active ? lines[index] : undefined
  const playLabel = status === 'playing' ? 'Pause broadcast' : status === 'paused' ? 'Resume broadcast' : 'Play broadcast'

  return (
    <section aria-labelledby="replay-title" data-agent="moderator" data-print="hide" className="surface overflow-hidden">
      <div className="ref-stripes h-3 border-b-[3px] border-line" aria-hidden="true" />
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        <div className="space-y-3.5">
          <div>
            <h2 id="replay-title" className="display text-4xl sm:text-5xl">Replay the fight</h2>
            <p className="mt-1.5 font-body leading-snug">The whole debate read aloud by six voices, from the opening bell to the verdict.</p>
          </div>
          <OnAir on={status === 'playing'} sounding={b.snap.sounding} role={line?.voice ?? null} who={line?.who} />
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous line" title="Previous line" onClick={() => b.prev()} disabled={!active}
              className="slab grid size-11 place-items-center bg-panel text-ink">
              <SkipIcon back />
            </button>
            <button type="button" aria-label={playLabel} onClick={transport}
              className="slab inline-flex min-h-11 flex-1 items-center justify-center gap-2 bg-accent px-4 text-on-accent">
              {status === 'playing' ? <PauseIcon /> : <PlayIcon />}
              <span aria-hidden="true">{status === 'playing' ? 'Pause' : status === 'paused' ? 'Resume' : status === 'ended' ? 'Play again' : 'Play'}</span>
            </button>
            <button type="button" aria-label="Next line" title="Next line" onClick={() => b.next()} disabled={!active}
              className="slab grid size-11 place-items-center bg-panel text-ink">
              <SkipIcon />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="w-12 text-sm font-extrabold" aria-hidden="true">Speed</span>
            <Segmented<Speed>
              label="Speed"
              value={String(rate) as Speed}
              onPick={(v) => b.setRate(Number(v))}
              options={SPEEDS.map((s) => ({ value: String(s) as Speed, label: `${s}x` }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="w-12 text-sm font-extrabold" aria-hidden="true">Voice</span>
            <Segmented
              label="Voice"
              value={b.engine}
              onPick={pickVoice}
              options={[
                { value: 'instant', label: 'Instant', disabled: !b.instantAvailable, title: 'Your browser\'s built-in voices. No download.' },
                { value: 'hd', label: 'HD (beta)', title: 'Natural voices that run on this device. One-time download.' },
              ]}
            />
            <HdLoading hd={b.hd} />
          </div>
          {!b.instantAvailable && <p className="text-sm font-semibold text-muted">This browser has no built-in voices. HD voices still work.</p>}
          {asking && (
            <HdConsent
              onAccept={() => { rememberHdConsent(); setAsking(false); b.remember('hd'); void b.start('hd', active ? undefined : status === 'ended' ? 0 : undefined) }}
              onDecline={() => setAsking(false)}
            />
          )}
          {b.notice && <p role="status" className="text-sm font-semibold">{b.notice}</p>}
        </div>

        <ol ref={list} aria-label="Broadcast captions" className="relative max-h-[26rem] space-y-2 overflow-y-auto pr-1">
          {lines.map((l, i) => {
            const current = active && i === index
            const agent = l.voice === 'founder' ? 'moderator' : l.voice
            return (
              <li key={l.key} ref={(el) => { items.current[i] = el }} data-agent={agent} aria-current={current ? 'true' : undefined}>
                <button
                  type="button"
                  onClick={() => playFrom(i)}
                  className={`block w-full rounded border-[3px] px-3 py-2 text-left transition-colors duration-150 ${current ? 'border-line bg-panel shadow-[4px_4px_0_var(--agent)]' : 'border-transparent hover:border-line hover:bg-panel-hi'}`}
                  style={current ? { borderLeftWidth: 10, borderLeftColor: 'var(--agent)' } : undefined}
                >
                  <span className="sr-only">Play from here: </span>
                  <span className="mr-1.5 font-ui text-sm font-extrabold text-(--agent-ink)">{l.who}</span>
                  <span className="font-body text-sm leading-relaxed">
                    {current ? <CaptionText chunks={chunks} current={chunk} /> : <span className={i < index && active ? 'text-muted' : ''}>{l.text}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
