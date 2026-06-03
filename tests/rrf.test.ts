import { describe, it, expect } from 'vitest'
import { reciprocalRankFusion } from '@/lib/rrf'

describe('reciprocalRankFusion', () => {
  it('ranks a doc strong in BOTH lists above docs strong in only one', () => {
    // 'a' is #1 in vector and #1 in fts -> highest RRF.
    const vector = [
      { id: 'a', similarity: 0.99 },
      { id: 'b', similarity: 0.98 },
    ]
    const fts = [
      { id: 'a', rank: 1 },
      { id: 'c', rank: 2 },
    ]
    const out = reciprocalRankFusion(vector, fts, { minSimilarity: 0 })
    expect(out[0].id).toBe('a')
  })

  it('rescues an exact-keyword match that vector search alone would bury', () => {
    // 'doc4' has 0 vector similarity but tops FTS (exact term). A semantically
    // mediocre doc ('pasta') has a small vector score. RRF should rank doc4 above pasta.
    const vector = [
      { id: 'relevant', similarity: 0.95 },
      { id: 'pasta', similarity: 0.05 },
      { id: 'doc4', similarity: 0.0 },
    ]
    const fts = [
      { id: 'doc4', rank: 1 },
      { id: 'relevant', rank: 2 },
    ]
    const out = reciprocalRankFusion(vector, fts, { minSimilarity: 0 })
    const order = out.map(h => h.id)
    expect(order.indexOf('doc4')).toBeLessThan(order.indexOf('pasta'))
  })

  it('applies the similarity threshold to the vector list', () => {
    const vector = [
      { id: 'high', similarity: 0.9 },
      { id: 'low', similarity: 0.1 }, // below default 0.3
    ]
    const out = reciprocalRankFusion(vector, [], { minSimilarity: 0.3 })
    const ids = out.map(h => h.id)
    expect(ids).toContain('high')
    expect(ids).not.toContain('low')
  })

  it('drops NaN similarity (the zero-norm vector bug) instead of letting it pass', () => {
    // Regression guard: in pgvector, cosine distance of a zero-norm vector is NaN,
    // and NaN >= threshold sneaks through in SQL. The pure version must drop it.
    const vector = [
      { id: 'ok', similarity: 0.8 },
      { id: 'nan', similarity: NaN },
    ]
    const out = reciprocalRankFusion(vector, [], { minSimilarity: 0.3 })
    const ids = out.map(h => h.id)
    expect(ids).toContain('ok')
    expect(ids).not.toContain('nan')
  })

  it('returns empty when nothing clears the threshold and FTS is empty', () => {
    const vector = [{ id: 'x', similarity: 0.1 }]
    const out = reciprocalRankFusion(vector, [], { minSimilarity: 0.3 })
    expect(out).toEqual([])
  })

  it('respects matchCount', () => {
    const vector = Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, similarity: 0.9 - i * 0.05 }))
    const out = reciprocalRankFusion(vector, [], { minSimilarity: 0, matchCount: 3 })
    expect(out).toHaveLength(3)
  })

  it('uses rrfK as a damping constant (larger k flattens rank advantage)', () => {
    const vector = [
      { id: 'first', similarity: 0.9 },
      { id: 'second', similarity: 0.8 },
    ]
    const small = reciprocalRankFusion(vector, [], { minSimilarity: 0, rrfK: 1 })
    const large = reciprocalRankFusion(vector, [], { minSimilarity: 0, rrfK: 1000 })
    const gap = (o: typeof small) => o[0].rrfScore - o[1].rrfScore
    // With a larger k, the score gap between rank 1 and rank 2 shrinks.
    expect(gap(large)).toBeLessThan(gap(small))
  })
})
