# Engineering Notes

A record of the architecture and the reasoning behind it. The goal is to show the thinking, not just the result. For *what* the system does, see the [README](README.md); this document is about *why* it's built the way it is — including the things deliberately **not** built.

This is a portfolio project running on free tiers, and a live public demo. That second fact turns out to drive the hardest engineering in it. If you only read one section, read the next one — it's where the real work lives.

---

## 0. Isolating cost per person on a public demo — the decisions that took thought

A RAG demo that anyone on the internet can use has a problem most tutorials ignore: **every query spends real money** on embeddings and model generation. The naïve public demo is one rotated-IP loop away from either a surprise bill or an exhausted budget that leaves the next visitor — say, a hiring manager — staring at an error. Getting this right meant accepting that the obvious defenses don't actually work, and that the real fix lives in three layers that each cover what the others can't.

### 0.1 The core mechanism: an atomic spend ledger keyed to verified identity

Every paid request is gated by a per-user spend total, accumulated in Postgres and enforced in one atomic statement:

```sql
insert into usage (user_id, spent_micros, query_count)
  values (p_user_id, greatest(p_cost_micros, 0), 1)
on conflict (user_id) do update
  set spent_micros = usage.spent_micros + greatest(p_cost_micros, 0)
returning usage.spent_micros;
```

The invariant this enforces: **a user's running cost is read, incremented, and re-checked without a window in which two requests can both see a stale total.** The upsert *is* the design — the read-modify-write happens inside a single SQL round-trip, holding the row, so concurrency can't slip past the cap. Cost is stored in *micros* (millionths of a dollar) because a query costs a fraction of a cent and accumulating those as floats would drift.

### 0.2 Why "verified identity" is the whole ballgame

The cap above is only meaningful if `user_id` can't be forged or cheaply regenerated. This is the decision everything else hangs on.

Suppose you do the naïve thing: identify users by an anonymous id the browser generates and stores in `localStorage` (the original design did exactly this — an `owner_id` header). Now the exact attack the cap was meant to stop costs nothing: clear `localStorage`, get a fresh identity, spend another cap's worth. The "limit" is a speed bump you reset with one keystroke. Per-IP rate limiting fails the same way for a different reason — serverless runs N instances each with its own in-memory counter, so the real limit is `limit × instances`, and it resets on cold start, and anyone serious rotates IPs anyway.

The fix is to make identity *expensive to mint*. The system requires OAuth sign-in (Google or GitHub) via Supabase Auth, and the server derives the user id by **verifying the JWT**, not by trusting a header:

```ts
const { data } = await admin().auth.getUser(token) // verifies signature
```

A forged or expired token returns nothing and the route answers 401. Google's one-account-per-device friction is doing real anti-abuse work here: a determined attacker *can* create accounts, but the economics flipped from "run a loop" to "manufacture verified accounts," which filters essentially all opportunistic abuse. Both providers resolve to one Supabase identity, so the cap is shared across them with nothing extra to wire.

### 0.3 Why the cap is checked twice — free rejection, then honest billing

A single check isn't enough, and the reason is about *where the money is spent*. The route checks spend **before** calling any model (`check_spend`, a read — so an already-over-limit user is rejected without spending a cent) and records actual cost **after** (`record_spend`, the atomic write above). The pre-check is the cheap gate; the post-record is the truthful ledger. Billing the embedding cost even when retrieval returns nothing, and billing accumulated cost on a mid-stream crash, both close small holes where a user could otherwise get free work.

### 0.4 Why the financial backstop lives outside the code

No amount of application logic protects against a bug in the application logic. The hard ceiling — the thing that makes a surprise bill *impossible* rather than *unlikely* — is a provider-side spend cap on a **dedicated Anthropic workspace and OpenAI project** created solely for the demo. If every layer above failed at once, the worst case is the demo pausing when its isolated budget is hit; personal API usage is in a different workspace and never goes down. The per-user cap protects *availability* (one abuser can't starve everyone else); the provider cap protects against *ruin*. They solve different problems, which is why both exist.

### 0.5 Defense in depth: RLS as the backstop to the backstop

Row-Level Security scopes every row to `auth.uid()` at the database. The API uses the service-role key, which *bypasses* RLS — so why enable it? Because it costs nothing and closes the failure mode where a future route forgets its owner filter, or the anon key is ever used for a direct browser read. The verified user id, not application discipline, becomes the thing that scopes data.

---

## 1. Architecture overview

```
                         OAuth (Google / GitHub)
                                  │  verified JWT
                                  ▼
  Browser ──auth'd fetch──▶  Next.js API routes (Vercel, serverless)
   (React)   Bearer token        │
                                  ├──▶ OpenAI  text-embedding-3-small  (embeddings)
                                  ├──▶ Anthropic  Claude Sonnet  (generation, SSE)
                                  └──▶ Supabase Postgres + pgvector
                                         • documents / chunks  (HNSW + FTS)
                                         • hybrid_search()  (vector ⊕ FTS via RRF)
                                         • usage ledger + spend cap  (atomic)
                                         • Row-Level Security
```

**Stack:** TypeScript · Next.js 14 (App Router, Node runtime) · Supabase Postgres + pgvector · OpenAI embeddings · Anthropic generation · Vercel hosting.

**Core design principle:** retrieval quality and cost safety are both *correctness* problems, not features bolted on top — so each lives as close to the data as possible (fusion and spend enforcement in SQL, identity verified server-side) rather than in fragile client or middle-tier code.

### Why hybrid retrieval is the centerpiece of the *retrieval* story

Vector search alone looks like it works, then fails in production on exactly the queries users care about: exact error codes, proper nouns, version numbers. The embedding of a rare token isn't distinctive, so it gets diluted and out-ranked by a semantically "close" but wrong chunk. Section 2 is the retrieval engine that fixes that; Section 0 is the cost engine that lets it run in public. Those are the two hard parts.

---

## 2. The retrieval engine

### 2.1 Hybrid search (vector + full-text) fused with RRF

Run vector similarity **and** Postgres full-text search, then fuse the two ranked lists with Reciprocal Rank Fusion inside a single `hybrid_search` SQL function.

Vector search is strong on semantics ("car" finds "automobile") and weak on exact, rare tokens. Full-text search is the opposite: exact on keywords, blind to paraphrase. Each method's blind spot is precisely the other's strength, so running both and merging covers both.

**Why RRF specifically.** The two methods' scores aren't comparable: cosine similarity is bounded `[0,1]`, `ts_rank` is unbounded. Adding them compares apples to oranges; normalizing is fragile and one outlier wrecks the scale. RRF ignores scores entirely and fuses on **rank**:

```
RRF(d) = Σ  1 / (k + rank_in_list(d))
```

Documents that rank well in *both* lists rise; `k=60` (the original paper's value) damps the top ranks so a single first place can't dominate. Scale-free by construction, no tuning.

**Why it lives in SQL.** Fusion needs ranks from both lists, and `row_number() over (order by ...)` produces them naturally in Postgres. Doing it in TypeScript would mean two round-trips plus client-side merging; in SQL it's one RPC with everything in memory.

**Concrete payoff.** In testing, vector-only search ranked a semantically-mediocre chunk (a cooking analogy with a non-orthogonal vector) *above* a chunk containing the exact error code being searched for. Hybrid + RRF moved the exact match to where it belonged. That gap is the whole reason the feature exists.

### 2.2 HNSW over ivfflat for the vector index

`hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64)`, replacing the original `ivfflat (lists = 100)`.

Both are approximate nearest-neighbour; the practical difference is tuning. ivfflat scans `probes` clusters at query time, and `probes` defaults to **1** — the correct neighbour can sit in a cluster the search never visits, so recall is poor unless you tune `probes`/`lists` together and scale with row count. ivfflat also wants data present at build time to cluster well; this schema creates the index before any rows exist. HNSW is a layered proximity graph: high recall **without** query-time tuning, and it builds fine on an empty table.

**Trade-off:** HNSW costs more to build and more memory/disk. For a read-heavy knowledge base where recall-without-tuning is the goal, that's the right side of the trade. ivfflat wins at tens of millions of vectors — not this scale.

### 2.3 Token-accurate chunking, and why not semantic chunking

Count real tokens with `js-tiktoken` (`cl100k_base`, the tokenizer for `text-embedding-3-small`), replacing the `1 token ≈ 4 chars` approximation. That approximation is fine for prose and badly wrong for dense content: a 58-character JSON snippet is 24 real tokens, not the ~15 that `chars/4` predicts. Under-counting meant "512-token" chunks were sometimes 800+ real tokens, diluting the embedding and risking limits.

The strategy packs whole sentences until the next would exceed the limit, carries a sentence-tail overlap forward, and hard-splits a single oversized sentence (code, unpunctuated text). The invariant — no chunk ever exceeds `maxTokens` on any path — is tested.

**Semantic chunking: evaluated, rejected.** It adds an embedding call per sentence at ingestion, a boundary-detection dependency, and a threshold to tune, for a marginal quality gain over "token limit + sentence boundaries." Choosing not to build it is the more defensible call at this scope.

---

## 3. Problems hit and how they were solved

### Correctness — the NaN bug in the similarity threshold

**Irrelevant queries returned five chunks instead of zero.** The query path drops chunks below a minimum cosine similarity (`0.3`) so off-topic questions short-circuit to "I don't have enough information" before any generation call. The first filter, `(1 - distance) >= min_similarity`, silently failed: cosine distance is undefined for a zero-norm vector and pgvector returns **NaN**, and in Postgres `NaN` compares as *equal to itself* and *≥ any number* — so both `x = x` and `x >= threshold` let it through. → Fix: explicit rejection, `(1 - distance) <> 'NaN'::float8`, verified against a real local Postgres + pgvector. → Lesson: reading the code would never have caught this; it only surfaced run against the actual engine, whose NaN semantics differ from the IEEE behaviour I'd assumed. The pure-TS mirror carries the same guard via `Number.isNaN`, with a regression test.

### Deploy — the live demo's git connection broke after a force-push

**Vercel reported "the provided GitHub repository can't be found" and refused to redeploy.** Root cause: rewriting history with `--force` orphaned the commit Vercel held as its deployment reference, so it was looking for a commit that no longer existed. → Fix: reconnect the repo in Project Settings → Git, then trigger a fresh deploy with an empty commit rather than re-running the stale "Redeploy" (which still pointed at the dead commit). → Lesson: a force-push isn't just a local concern; anything holding a commit SHA downstream (CI, hosting) has to be re-pointed.

### Local dev — the file picker didn't filter to PDF/TXT on Windows

**The OS file dialog opened to "custom files," forcing a manual switch to "all files."** Root cause: `accept=".pdf,.txt"` (bare extensions) isn't reliably mapped to a labelled filter by every OS. → Fix: include MIME types alongside extensions, `accept="application/pdf,text/plain,.pdf,.txt"`. → Note: `accept` is only a *hint* to the native picker — never a security control. Real validation is server-side (`ALLOWED_TYPES`), and was already there.

---

## 4. Resilience / correctness decisions baked into the code

- **Atomic spend upsert.** Prevents the lost-update race where two concurrent requests both read an under-cap total and both proceed (§0.1).
- **JWT verified, not trusted.** A forged/expired token yields no user and a 401, rather than scoping to an attacker-supplied id (§0.2).
- **Cost billed on every exit path.** Embedding cost is recorded even when retrieval returns zero chunks, and accumulated cost is flushed on a mid-stream error — closing free-work holes.
- **Content-hash dedup with a DB unique constraint.** SHA-256 of file *content* (names change, content is identity) in a `UNIQUE` column. The app checks before inserting, but two simultaneous uploads can both pass the check; the constraint catches it and `insertDocument` handles the `23505` violation by returning the existing row instead of a 500. Defense at both layers.
- **Owner-scoped deletes.** `deleteDocument` filters by `(id, ownerId)`, so a request for someone else's document deletes nothing and returns 404 — ownership is in the WHERE clause, not a separate check that could be skipped.
- **SSE `error` event after status commit.** Once the stream's 200 is flushed the HTTP status can't change, so mid-stream failures are signalled as a named `error` event the client renders, not a silent truncation.

---

## 5. Known trade-offs (scope constraints)

- **`waitUntil` for async ingestion, not a durable queue.** Chosen because the slow part (embedding calls) is I/O, which doesn't count against Vercel's CPU budget, and `waitUntil` decouples the user experience from the embed step with no extra service. The seam to scale it: a real durable queue (Vercel Workflows / QStash / Inngest), needed once a document genuinely requires more than 60s of wall-clock work — the one pathological case `waitUntil` does not solve.
- **RRF mirrored in a pure TS function for testing.** Production fusion runs in SQL; `lib/rrf.ts` mirrors it so the logic is unit-testable without Postgres in CI. The cost: the logic exists twice and could drift. Mitigated by a header comment flagging the mirror and `scripts/test_hybrid_search.sql` as a manual integration check. Worth it for instant, dependency-free tests — but a real trade, not a free lunch.
- **Hand-rolled SSE over the Vercel `ai` SDK.** RAG streams a *mixed* payload — structured sources up front, then text token-by-token — which SSE's named events model directly, and hand-writing it demonstrates the mechanism. Defensible in both directions; the SDK would be a reasonable production pick. A conscious trade, not a clear winner.
- **Single embedding provider, no abstraction.** A pluggable `EmbeddingProvider` interface (OpenAI + local `@xenova/transformers`) was built, then *removed*: embeddings cost ~$0.02/M tokens, so "free local embeddings" saved rounding error while adding a native binary, a second schema, and a per-upload dimension choice. An abstraction with one real implementation is just indirection. Knowing when *not* to abstract is the same skill as knowing when to. (Related: vector dimension is part of the schema — `vector(N)` is fixed-N — so switching providers means re-indexing everything. Intentional, worth knowing.)
- **Stateless Q&A — each question is independent, no conversation memory.** Every query goes to the model as a single `user` message containing only the freshly retrieved chunks plus the current question; prior turns are rendered in the UI but never sent back to the model (`generateAnswer` in `lib/embeddings.ts` takes a question and context, not a history). Two reasons make this the right default *for this design*: (1) the per-user spend cap stays honest — cost per query is bounded by `context + question + 512 output tokens` and doesn't grow turn-over-turn, which it would if history were appended; (2) it reinforces the grounding contract — the system prompt forbids prior knowledge and demands answers come only from retrieved chunks, and replaying earlier turns is exactly the channel through which a model starts answering from conversation instead of context. The cost: follow-ups like "and the second one?" don't resolve, because the model has no referent. The seam to add memory: thread the last N turns into the `messages` array and (ideally) fold them into retrieval so the search itself is context-aware — deferred because it materially complicates both cost accounting and the spend cap.

---

## 6. What I'd do next (production hardening)

- **Ingestion queue.** Replace `waitUntil` with durable execution once documents exceed the function budget — the first thing that breaks at scale. The seam is already clean: ingestion is decoupled from the response, so only the runner changes.
- **Cross-encoder re-ranking.** Add a re-ranker after RRF for higher top-k precision. Skipped now because it's a model call per query for a gain that doesn't justify itself at this scale; RRF's output is already the natural input to it.
- **Retrieval-quality eval harness.** A labelled question→relevant-chunk set to measure recall/precision changes instead of eyeballing them. The honest gap: the *logic* of HNSW and hybrid search is validated, but recall at real scale is only knowable with real data and a real eval set.
- **Rolling spend windows.** The per-user cap is currently a lifetime demo budget. A `window_start` column reset in `record_spend` would turn it into a daily allowance — a small change the ledger is already shaped for.
- **Layout-aware chunking.** Semantic or table/code-aware splitting becomes worth its cost once the corpus is large and heterogeneous — not before.
