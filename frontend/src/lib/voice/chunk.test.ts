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

  it('speaks the first sentence alone, then packs sentences up to the limit', () => {
    const s = 'First point here. Second point here! Third point here? Fourth.'
    expect(chunkText(s, 40)).toEqual(['First point here.', 'Second point here! Third point here?', 'Fourth.'])
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

  it('does not end a sentence at a common abbreviation or an initial', () => {
    expect(chunkText('Dr. Patel and Mrs. Gomez agree, e.g. on price vs. Angi Inc. today. Next point.'))
      .toEqual(['Dr. Patel and Mrs. Gomez agree, e.g. on price vs. Angi Inc. today.', 'Next point.'])
    expect(chunkText('J. R. Smith built it. It works.')).toEqual(['J. R. Smith built it.', 'It works.'])
    expect(chunkText('We tried, i.e. twice. Then stopped.')).toEqual(['We tried, i.e. twice.', 'Then stopped.'])
  })
})
