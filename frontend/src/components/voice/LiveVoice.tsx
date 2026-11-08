import { useMemo, useState } from 'react'
import type { DebateState } from '../../lib/debateReducer'
import { liveScript } from '../../lib/voice/script'
import { hasHdConsent, rememberHdConsent, type VoicePref } from '../../lib/voice/preference'
import { HdConsent, HdLoading, OnAir, Segmented } from './VoiceControls'
import { useBroadcast } from './useBroadcast'

/**
 * Listen live: each finished turn is read aloud in order, with the moderator calling the rounds and
 * checkpoints. The text keeps streaming on screen whatever the voice is doing.
 */
export default function LiveVoice({ state }: { state: DebateState }) {
  const lines = useMemo(() => liveScript(state), [state])
  const b = useBroadcast(lines, true)
  const [asking, setAsking] = useState(false)
  const { status, index } = b.snap
  const listening = status === 'playing' || status === 'waiting'
  const line = status === 'playing' || status === 'paused' ? lines[index] : undefined
  const behind = status === 'playing' ? lines.length - 1 - index : 0

  // Joining mid-fight starts at the newest line rather than replaying the whole backlog.
  const listen = (kind: 'instant' | 'hd') => void b.start(kind, Math.max(0, lines.length - 1))

  function pick(p: VoicePref) {
    if (p === 'hd' && !hasHdConsent()) { setAsking(true); return }
    setAsking(false)
    if (p === 'off') { b.choose('off', false); return }
    b.remember(p)
    if (status === 'paused') b.choose(p, true)
    else if (listening) b.choose(p, false)
    else listen(p)
  }

  function toggle() {
    if (status === 'waiting') b.stop()
    else if (listening) b.pause()
    else if (status === 'paused') b.resume()
    else listen(b.engine)
  }

  return (
    <section aria-label="Voice" data-print="hide" className="surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <OnAir on={status === 'playing' && !!line} sounding={b.snap.sounding} role={line?.voice ?? null} who={line?.who} />
        <span className="text-sm font-extrabold" aria-hidden="true">Voice</span>
        <Segmented
          label="Voice"
          value={b.pref}
          onPick={pick}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'instant', label: 'Instant', disabled: !b.instantAvailable, title: 'Your browser\'s built-in voices. No download.' },
            { value: 'hd', label: 'HD (beta)', title: 'Natural voices that run on this device. One-time download.' },
          ]}
        />
        {b.pref !== 'off' && (
          <button type="button" onClick={toggle} aria-pressed={listening} className="slab bg-panel px-3 py-1 text-sm text-ink">
            {listening ? 'Pause voice' : 'Listen live'}
          </button>
        )}
        {behind > 0 && (
          <button type="button" onClick={b.jumpToLive} className="slab bg-accent px-3 py-1 text-sm text-on-accent">
            Jump to live ({behind} behind)
          </button>
        )}
        <HdLoading hd={b.hd} />
        {!b.instantAvailable && <span className="text-sm font-semibold text-muted">This browser has no built-in voices.</span>}
      </div>
      {asking && (
        <div className="mt-2">
          <HdConsent
            onAccept={() => { rememberHdConsent(); setAsking(false); b.remember('hd'); listen('hd') }}
            onDecline={() => setAsking(false)}
          />
        </div>
      )}
      {b.notice && <p role="status" className="mt-1.5 text-sm font-semibold">{b.notice}</p>}
      {line && (
        <p role="group" aria-label="Captions" data-agent={line.voice === 'founder' ? 'moderator' : line.voice} className="mt-2 border-l-[6px] border-(--agent) pl-3 font-body text-sm leading-snug sm:text-base">
          <span className="mr-1.5 font-ui font-extrabold text-(--agent-ink)">{line.who}</span>
          {b.snap.chunks[b.snap.chunk] ?? ''}
        </p>
      )}
    </section>
  )
}
