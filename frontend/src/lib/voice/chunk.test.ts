import { describe, expect, it } from 'vitest'
import { CHUNK_MAX, chunkText } from './chunk'

const words = (s: string) => s.split(/\s+/).filter(Boolean)

describe('chunkText', () => {
  it('returns nothing for blank text', () => {
    expect(chunkText('   \n ')).toEqual([])
  })

  it('keeps short text whole', () => {
    expect(chunkText('One line.')).toEqual(['One line.'])
  })

  it('splits at sentence ends and packs sentences up to the limit', () => {
    const s = 'First point here. Second point here! Third point here?'
    expect(chunkText(s, 40)).toEqual(['First point here. Second point here!', 'Third point here?'])
  })

  it('breaks a sentence longer than the limit at commas, then at spaces', () => {
    const long = `${'word '.repeat(60).trim()}, and then ${'more '.repeat(10).trim()}.`
    const chunks = chunkText(long, 60)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(60)
    expect(chunks.length).toBeGreaterThan(3)
  })

  it('never drops or trims a word, including leading punctuation', () => {
    const text = '...and so it begins. "Will it pay?" asked the investor; nobody knew. ' + 'x'.repeat(250) + ' The end'
    const chunks = chunkText(text)
    expect(words(chunks.join(' '))).toEqual(words(text))
    expect(chunks.join(' ')).toBe(text.replace(/\s+/g, ' ').trim())
    for (const c of chunks) if (!c.includes('xxx')) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX)
  })
})
