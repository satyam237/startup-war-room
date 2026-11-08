/**
 * Splits text into pieces short enough to speak one at a time. Short pieces bring the first sound sooner
 * (the HD model renders a piece before it plays), let pause and speed act quickly, and stay clear of
 * browsers that cut off long utterances. Nothing is dropped: the pieces joined by spaces are the input
 * with its whitespace collapsed.
 */
export const CHUNK_MAX = 180

const SENTENCE_END = /(?<=[.!?…]["'”’)\]]*)\s+/
const CLAUSE_END = /(?<=[,;:])\s+/

function pack(pieces: string[], max: number): string[] {
  const out: string[] = []
  for (const p of pieces) {
    const last = out.at(-1)
    if (last !== undefined && last.length + 1 + p.length <= max) out[out.length - 1] = `${last} ${p}`
    else out.push(p)
  }
  return out
}

/** Breaks one over-long piece at clause marks, then at word gaps. A single word longer than `max` stays whole. */
function split(piece: string, max: number): string[] {
  if (piece.length <= max) return [piece]
  const clauses = piece.split(CLAUSE_END)
  if (clauses.length > 1) return pack(clauses.flatMap((c) => split(c, max)), max)
  return pack(piece.split(' '), max)
}

export function chunkText(text: string, max = CHUNK_MAX): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  return pack(clean.split(SENTENCE_END).flatMap((s) => split(s, max)), max)
}
