import type { AgentId } from '../lib/debateReducer'

/** One bold mark per fighter, drawn in the ink colour so it sits on any agent fill. */
export default function FighterGlyph({ agent, className = 'size-10' }: { agent: AgentId; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      {agent === 'vc' && (
        <g {...common}>
          <path d="M8 40V30M20 40V22M32 40V14M44 40" />
          <path d="M6 20l12-10 8 6 16-12" />
          <path d="M34 4h8v8" />
        </g>
      )}
      {agent === 'customer' && (
        <g {...common}>
          <circle cx="24" cy="24" r="17" />
          <path d="M16 28c2.5 5 13.5 5 16 0" />
          <path d="M17 18v2M31 18v2" strokeWidth="5" />
        </g>
      )}
      {agent === 'cto' && (
        <g {...common}>
          <path d="M16 12L5 24l11 12M32 12l11 12-11 12M28 8L20 40" />
        </g>
      )}
      {agent === 'competitor' && (
        <g {...common} fill="currentColor">
          <path d="M28 3L9 27h13l-3 18 20-26H25z" />
        </g>
      )}
      {agent === 'moderator' && (
        <g {...common}>
          <path d="M24 6a4 4 0 0 1 4 4v1.2c5.2 1.4 8 5.8 8 11.3V30l4 5H8l4-5v-7.5c0-5.500 2.800-9.900 8-11.300V10a4 4 0 0 1 4-4z" />
          <path d="M19 40a5 5 0 0 0 10 0" />
        </g>
      )}
    </svg>
  )
}
