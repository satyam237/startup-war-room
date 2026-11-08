import FighterGlyph from './FighterGlyph'

/** The referee's bell. It swings when `ringing` is set; otherwise it hangs still. */
export default function Bell({ ringing = false, className = 'size-7' }: { ringing?: boolean; className?: string }) {
  return (
    <span data-testid="bell" data-ringing={ringing} className={`inline-block ${ringing ? 'bell-ring' : ''}`}>
      <FighterGlyph agent="moderator" className={className} />
    </span>
  )
}
