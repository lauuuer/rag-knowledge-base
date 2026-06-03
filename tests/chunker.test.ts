import { describe, it, expect } from 'vitest'
import { chunkText, countTokens } from '@/lib/chunker'

describe('countTokens', () => {
  it('counts real tokens, not the chars/4 approximation', () => {
    const json = '{"name": "test", "values": [1,2,3], "nested": {"a": true}}'
    const real = countTokens(json)
    const approx = Math.round(json.length / 4)
    // The whole point of #6: dense JSON has MORE tokens than chars/4 estimates.
    expect(real).toBeGreaterThan(approx)
  })

  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0)
  })
})

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    const r = chunkText('Hello world. This is short.', 512, 50)
    expect(r).toHaveLength(1)
  })

  it('returns [] for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\n  ')).toEqual([])
  })

  it('never emits a chunk exceeding maxTokens (sentence packing)', () => {
    const text = Array.from({ length: 60 }, (_, i) =>
      `This is sentence number ${i} with some filler words here.`
    ).join(' ')
    const max = 40
    const chunks = chunkText(text, max, 8)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(countTokens(c)).toBeLessThanOrEqual(max)
    }
  })

  it('hard-splits a single oversized sentence and still respects maxTokens', () => {
    const huge = 'word '.repeat(300).trim() // one "sentence", ~300 tokens
    const max = 50
    const chunks = chunkText(huge, max, 10)
    expect(chunks.length).toBeGreaterThanOrEqual(5)
    for (const c of chunks) {
      expect(countTokens(c)).toBeLessThanOrEqual(max)
    }
  })

  it('overlaps content between consecutive chunks', () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Sentence ${i} alpha beta gamma.`)
    const text = sentences.join(' ')
    const chunks = chunkText(text, 40, 12)
    // With overlap, some sentence at the tail of chunk[i] should reappear at the
    // head of chunk[i+1]. Check at least one adjacent pair shares a sentence.
    let shared = false
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = sentences.filter(s => chunks[i - 1].includes(s))
      const currHead = sentences.filter(s => chunks[i].includes(s))
      if (prevTail.some(s => currHead.includes(s))) { shared = true; break }
    }
    expect(shared).toBe(true)
  })
})
