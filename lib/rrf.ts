/**
 * Reciprocal Rank Fusion (RRF) — pure, testable mirror of the SQL `hybrid_search`
 * fusion logic. Production retrieval runs in Postgres (scripts/schema.sql); this
 * module exists so the fusion + threshold rules can be unit-tested without a
 * database. Keep the two in sync — see ENGINEERING_NOTES.md.
 *
 * RRF(d) = sum over lists of 1 / (k + rank_in_list(d))
 * Fusing by RANK (not score) avoids normalizing incompatible score scales
 * (cosine 0..1 vs ts_rank unbounded).
 */

export interface VectorHit {
  id: string
  /** cosine similarity in [0,1]; NaN for degenerate (zero-norm) vectors */
  similarity: number
}

export interface FtsHit {
  id: string
  /** ts_rank score; only the resulting order (rank) matters for RRF */
  rank: number
}

export interface FusedHit {
  id: string
  rrfScore: number
  /** similarity from the vector list, or 0 if matched only via FTS */
  similarity: number
}

export interface RrfOptions {
  matchCount?: number      // final number of results (default 5)
  minSimilarity?: number   // vector threshold; below this is dropped (default 0.3)
  rrfK?: number            // RRF damping constant (default 60)
  candidatePool?: number   // how many to take from each list before fusing (default 30)
}

const DEFAULTS = { matchCount: 5, minSimilarity: 0.3, rrfK: 60, candidatePool: 30 }

/**
 * Fuse a vector-similarity list and a full-text list with RRF.
 *
 * @param vectorHits  candidates with cosine similarity (order ignored; ranked here)
 * @param ftsHits     candidates with an ts_rank score (order ignored; ranked here)
 */
export function reciprocalRankFusion(
  vectorHits: VectorHit[],
  ftsHits: FtsHit[],
  options: RrfOptions = {}
): FusedHit[] {
  const { matchCount, minSimilarity, rrfK, candidatePool } = { ...DEFAULTS, ...options }

  // --- Vector list: drop NaN (undefined cosine for zero-norm vectors) and
  //     anything below the similarity threshold, then rank by similarity desc. ---
  const vector = vectorHits
    .filter(h => !Number.isNaN(h.similarity) && h.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, candidatePool)

  const vectorRank = new Map<string, number>()   // id -> 1-based rank
  const vectorSim = new Map<string, number>()
  vector.forEach((h, i) => {
    vectorRank.set(h.id, i + 1)
    vectorSim.set(h.id, h.similarity)
  })

  // --- FTS list: rank by ts_rank desc. ---
  const fts = [...ftsHits].sort((a, b) => b.rank - a.rank).slice(0, candidatePool)
  const ftsRank = new Map<string, number>()
  fts.forEach((h, i) => ftsRank.set(h.id, i + 1))

  // --- Fuse: union of ids, each list contributes 1/(k+rank), missing => 0. ---
  const ids = new Set<string>([...vectorRank.keys(), ...ftsRank.keys()])
  const fused: FusedHit[] = []
  for (const id of ids) {
    const vr = vectorRank.get(id)
    const fr = ftsRank.get(id)
    const rrfScore =
      (vr ? 1 / (rrfK + vr) : 0) + (fr ? 1 / (rrfK + fr) : 0)
    fused.push({ id, rrfScore, similarity: vectorSim.get(id) ?? 0 })
  }

  fused.sort((a, b) => b.rrfScore - a.rrfScore)
  return fused.slice(0, matchCount)
}
