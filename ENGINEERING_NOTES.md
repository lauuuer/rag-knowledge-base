# Engineering Notes

The reasoning behind the non-obvious choices in this project, the trade-offs each one carries, and the things I deliberately chose **not** to build. The goal here is honesty about constraints, not a feature list — for what the system does, see the [README](README.md).

This is a portfolio project running on free tiers. Several decisions only make sense in that light, and I've tried to say so rather than pretend the choices are universal.

---

## 1. HNSW over ivfflat for the vector index

**Choice:** `hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64)`, replacing the original `ivfflat (lists = 100)`.

Both indexes are approximate nearest-neighbour. The practical difference is tuning. ivfflat partitions vectors into `lists` clusters and, at query time, scans `probes` of them — and `probes` defaults to **1**. With a single probe, the correct neighbour can sit in a cluster the search never visits, so recall is poor unless you tune `probes` and `lists` together and scale `lists` with row count. ivfflat also wants data present when the index is built to cluster well; this project creates the index in the schema, before any rows exist.

HNSW is a layered proximity graph. It gives high recall **without** query-time tuning — there is no `probes` to get wrong — and it builds fine on an empty table.

**Trade-off:** HNSW costs more to build and uses more memory/disk than ivfflat. For a read-heavy knowledge base where recall-without-tuning is exactly what you want, that's the right side of the trade. ivfflat starts to win at tens of millions of vectors, where HNSW's memory footprint hurts — not this project's scale.

`ef_search` (default 40) can be raised per session for more recall at some latency cost; documented inline in `schema.sql`.

---

## 2. Hybrid search (vector + full-text) fused with RRF

**Choice:** run vector similarity **and** Postgres full-text search, then fuse the two ranked lists with Reciprocal Rank Fusion inside a single `hybrid_search` SQL function.

Vector search is strong on semantics ("car" finds "automobile") and weak on exact, rare tokens — error codes, proper nouns, acronyms, version numbers. The embedding of a rare string isn't distinctive, so it gets diluted. Full-text search is the opposite: exact on keywords, blind to paraphrase. Each method has a blind spot that is precisely the other's strength, so running both and merging covers both.

**Why RRF specifically.** The problem with merging two searches is that their scores aren't comparable: cosine similarity is bounded `[0,1]`, `ts_rank` is unbounded. Adding them is comparing apples to oranges, and normalizing (min-max etc.) is fragile — it depends on each query's distribution and one outlier wrecks the scale. RRF sidesteps this by ignoring scores entirely and fusing on **rank**:

```
RRF(d) = Σ  1 / (k + rank_in_list(d))
```

A document ranked #1 in vector contributes `1/(k+1)`; if it's also #5 in full-text it adds `1/(k+5)`. Documents that do well in *both* lists rise; `k=60` (the value from the original RRF paper) damps the weight of the very top ranks so a single first place can't dominate. It's scale-free by construction and needs no tuning.

**Why it lives in SQL.** Fusion needs the ranks from both lists, and `row_number() over (order by ...)` produces them naturally inside Postgres. Doing it in TypeScript would mean two round-trips (one query per method) plus client-side merging. In SQL it's one RPC with everything already in memory.

**Concrete payoff.** In testing, a vector-only search ranked a semantically-mediocre chunk (a cooking analogy that happened to have a non-orthogonal vector) *above* a chunk containing the exact error code being searched for. Hybrid + RRF moved the exact match to where it belonged. That gap is the whole reason the feature exists.

---

## 3. The NaN bug in the similarity threshold

This one is worth recording because it was a real bug found by testing against a real database, not a hypothetical.

The query path drops chunks below a minimum cosine similarity (default `0.3`) so that irrelevant questions return "I don't have enough information" before a generation call is ever made. The first implementation filtered with `(1 - distance) >= min_similarity`. It silently failed.

Cosine distance is undefined for a zero-norm vector, and pgvector returns **NaN** for it. The trap: in Postgres, `NaN` compares as **equal to itself** and as **greater than or equal to any number** — so both `x = x` and `x >= threshold` let NaN through. An irrelevant query that should have returned zero rows returned five.

The fix is an explicit rejection: `(1 - distance) <> 'NaN'::float8`. Verified by standing up Postgres + pgvector locally and asserting that a degenerate query returns no rows. The pure-TypeScript mirror (`lib/rrf.ts`) carries the same guard via `Number.isNaN`, and there's a regression test for it in `tests/rrf.test.ts`.

Lesson, honestly stated: I would not have caught this by reading the code. It only showed up when run against the actual engine, whose NaN semantics differ from the IEEE behaviour I assumed.

---

## 4. Token-accurate chunking, and why not semantic chunking

**Choice:** count real tokens with `js-tiktoken` (`cl100k_base`, the tokenizer for `text-embedding-3-small`), replacing the `1 token ≈ 4 chars` approximation.

The approximation is fine for prose and badly wrong for dense content. A 58-character JSON snippet is 24 real tokens; `chars/4` estimates 15 — a 60% underestimate. That means "512-token" chunks were sometimes 800+ real tokens of code or tables, which dilutes the embedding (a vector averaged over too much text is less distinctive) and risks limits. Counting tokens makes chunk size predictable.

The strategy packs whole sentences until the next one would exceed the limit, carries a sentence-tail overlap into the next chunk, and falls back to a hard token-split for a single sentence that is itself oversized (code blocks, unpunctuated text). The invariant — no chunk ever exceeds `maxTokens` on any path — is tested.

`js-tiktoken` is pure JS with no native binary, which matters: see note 6 for why that was a deciding factor.

**Semantic chunking: evaluated, rejected.** Splitting on meaning shifts (embedding each sentence to detect topic boundaries) sounds impressive but adds an embedding call per sentence at ingestion time, a boundary-detection dependency, and a threshold to tune. For typical documents the quality gain over "token limit + sentence boundaries" is marginal. For a portfolio it's effort that signals over-engineering rather than judgment. Choosing not to build it is the more defensible call.

**Tokenizer is model-specific.** `cl100k_base` is correct for the OpenAI embedding model. I did not abstract it behind a provider interface — the project is 100% OpenAI (see note 6), so abstraction would be speculative.

---

## 5. Asynchronous ingestion on a free tier

**The real constraint.** Vercel's Hobby tier caps a function at **60 seconds** (with Fluid Compute, which is the current default path). The slow part of ingestion isn't PDF parsing — it's the embedding calls. A large PDF can push past 60s. But there's a nuance that shapes the whole decision: time spent waiting on I/O (the OpenAI and Supabase calls) does **not** count as active CPU time, and ingestion is almost entirely I/O.

**Choice (deliberately the middle option).** The upload route does the fast, synchronous part — dedup check, text extraction — then inserts the document as `processing` and returns immediately. The heavy work (chunk → embed → store → flip status) runs *after* the response via Vercel's `waitUntil`. The front-end polls `/api/documents` every two seconds and stops once nothing is `processing`. No queue, no external worker, no extra service.

**Honest limitation.** `waitUntil` is still bound to the invocation's lifetime. This decouples the *user experience* from the embed step; it does **not** solve the pathological case of a PDF with hundreds of pages that genuinely needs more than 60s of wall-clock work. The correct tool for that is Vercel Workflows (durable execution that pauses/resumes/keeps state for minutes to months), which I left out on purpose — for this project it would be infrastructure for a problem the project doesn't have.

**Dedup.** A SHA-256 of file **content** (not the filename — names change, content is the identity) goes in a `UNIQUE` column. Re-uploading the same bytes returns the existing document instead of duplicating chunks. The application checks the hash before inserting, but there's a race: two simultaneous uploads of the same file both pass the check. The unique constraint catches it at the database, and `insertDocument` handles the `23505` violation by returning the existing row rather than throwing a 500. Defense at both layers.

---

## 6. Pluggable local embeddings: built, then deliberately removed

I prototyped an `EmbeddingProvider` interface with two implementations — OpenAI (`text-embedding-3-small`, 1536-dim) and a free local one (`@xenova/transformers`, `all-MiniLM-L6-v2`, 384-dim) — with correct mean-pooling + L2-normalization, a lazy pipeline singleton, a dimension guard, a second 384-dim schema, and a `next.config` to externalize the native binaries. It worked.

Then I removed it.

**Why.** The stated goal was "free embeddings." But embeddings cost about $0.02 per million tokens — the savings are rounding error. The real cost of the local provider was *complexity*: a native binary (`onnxruntime`/`sharp`) that's awkward to build, a second schema, and a per-dimension choice at upload time. I was adding an indirection layer for a second provider that would never actually run. That's speculative abstraction — and an abstraction with exactly one real implementation is just indirection.

Keeping the note here because the decision is the point: I knew how to build it, built it, and chose to throw it away because the complexity-versus-benefit trade didn't close. Knowing when *not* to abstract is the same skill as knowing when to.

(There is a related observation worth making explicit: switching embedding providers isn't just a code change. Vector dimension is part of the schema — a `vector(N)` column has fixed N — so a different provider means re-indexing everything. That's intentional and worth knowing, not a hidden gotcha.)

---

## 7. Streaming: hand-rolled SSE instead of a framework

The query route streams over Server-Sent Events with named events: `sources` first (the retrieved chunks are known before generation starts, so they render immediately), then one `delta` per token from Claude, then `done` — or `error` if generation fails mid-stream, since the HTTP status is already committed to 200 by then and can't be changed.

I used raw SSE rather than the Vercel `ai` SDK on purpose. RAG streams a *mixed* payload: structured sources up front plus text token-by-token. SSE's named events model that directly, and writing the protocol by hand demonstrates that I understand the mechanism rather than hiding it behind a hook. This is a defensible choice in both directions — the `ai` SDK would be the reasonable production pick — and I'd call it a conscious trade rather than a clear winner.

---

## 8. Testing: the minimum with the highest value

14 Vitest tests, ~1 second, no Postgres and no network. They target pure, non-trivial logic — the chunker (invariants: no chunk over the limit on any path, overlap, hard-split, token-vs-chars, empty input) and rank fusion (a doc strong in both lists ranks first, an exact-keyword match gets rescued above a semantically-mediocre one, the threshold, the NaN regression, `matchCount`, the effect of `k`).

**The honest part.** RRF runs in SQL in production. To unit-test it without spinning up Postgres in CI, I extracted the fusion into a pure function (`lib/rrf.ts`) that mirrors the SQL. That means the logic exists in two places and could drift. Mitigated by: a comment at the top of the file flagging it as a mirror, and `scripts/test_hybrid_search.sql` as a manual integration check against the real SQL. It's a trade I'd make again for a portfolio — instant, dependency-free tests — but it's a trade, not a free lunch.

**What I didn't test, and why:** the route handlers and the front-end. Testing them would mean mocking Supabase, Anthropic, and Vercel — at which point the test largely exercises the mock, not my logic. Low value for the effort here.

---

## What I'd change to scale

Honest list, roughly in order of when each would start to matter:

- **Ingestion queue.** Replace `waitUntil` with a real durable queue (Vercel Workflows, or QStash/Inngest) once documents are large enough to exceed the function budget. This is the first thing that breaks at scale.
- **Re-ranking.** Add a cross-encoder re-ranker after RRF for higher precision on the final top-k. Skipped here because it adds a model call per query and the quality gain doesn't justify it at this scale.
- **Evaluation harness.** A retrieval-quality eval set (questions with known-relevant chunks) to measure recall/precision changes instead of eyeballing them. The honest gap in this project: I validated the *logic* of HNSW and hybrid search, but recall at real scale is only knowable with real data and a real eval set.
- **Multi-tenancy.** Row-level security and per-user document scoping. The current design is single-instance.
- **Chunking revisited.** Semantic or layout-aware chunking becomes worth its cost once the corpus is large and heterogeneous (mixed PDFs, tables, code) — not before.
