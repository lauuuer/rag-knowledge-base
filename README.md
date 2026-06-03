# RAG Knowledge Base — Document Q&A System

A Retrieval-Augmented Generation (RAG) system. Upload documents (PDF or TXT), ask questions in natural language, and get accurate answers **with source citations** — grounded in your own content.

Built to demonstrate real AI engineering infrastructure: token-accurate chunking, hybrid retrieval (vector + full-text) with rank fusion, an HNSW vector index, end-to-end streaming, and resilient asynchronous ingestion.

> For the harder design decisions and their trade-offs, see [ENGINEERING_NOTES.md](ENGINEERING_NOTES.md).

---

## Live Demo

**[rag-knowledge-base-peach.vercel.app](https://rag-knowledge-base-peach.vercel.app/)**

> Deploy your own in ~10 minutes. See [docs/setup.md](docs/setup.md).

---

## Architecture

### Ingestion (`/api/upload`)

```
User uploads PDF/TXT
        │
        ▼
[Next.js API Route /api/upload]
        │
        ├─► SHA-256 of file content → dedup check
        │      └─ already ingested? return existing document, stop.
        │
        ├─► Extract raw text (pdf-parse / plain text)        [synchronous]
        │
        ├─► Insert document row as status = 'processing', return immediately
        │
        └─► AFTER the response (Vercel waitUntil):           [background]
               ├─ Chunk text (real token count, js-tiktoken)
               ├─ Embed chunks in batches (OpenAI text-embedding-3-small)
               ├─ Store chunks + embeddings → Supabase (pgvector)
               └─ Flip status → 'ready' (or 'failed' + error_message)

Front-end polls /api/documents until status settles.
```

### Query (`/api/query`)

```
User submits question
        │
        ▼
[Next.js API Route /api/query]
        │
        ├─► Embed the question (text-embedding-3-small)
        │
        ├─► Hybrid retrieval in Postgres (one RPC):
        │      ├─ Vector search (cosine, HNSW index) + similarity threshold
        │      ├─ Full-text search (tsvector / ts_rank)
        │      └─ Fuse both lists with Reciprocal Rank Fusion (RRF)
        │
        ├─► Stream over Server-Sent Events:
        │      ├─ event: sources  (sent first — rendered before any text)
        │      ├─ event: delta    (one per token from Claude)
        │      └─ event: done / error
        │
        └─► Claude (claude-sonnet-4-6) generates the answer, cited per source
```

### Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Vector store | Supabase pgvector | Managed Postgres — no separate infra, easy to self-host, and lets vector + full-text live in one query |
| Vector index | HNSW (`m=16`, `ef_construction=64`) | High recall **without** per-query tuning; ivfflat needs `probes`/`lists` tuned together and degrades when built on an empty table |
| Retrieval | Hybrid: vector + full-text, fused with RRF | Vector captures semantics; full-text captures exact/rare tokens (codes, names, acronyms). RRF fuses by rank, so the two incompatible score scales never need normalizing |
| Similarity threshold | Drop chunks below `0.3` cosine | Irrelevant queries return "I don't know" before spending a generation call |
| Chunking | Real token count via `js-tiktoken` (`cl100k_base`) | `chars/4` underestimates dense content (JSON/code) by up to ~60%; token counting keeps chunk size predictable |
| Embedding model | `text-embedding-3-small` (OpenAI) | Fast, cheap (~$0.02 / M tokens), 1536-dim, widely supported |
| Generation model | `claude-sonnet-4-6` | Strong reasoning for synthesis across multiple retrieved chunks |
| Streaming | Hand-rolled SSE (`sources` + `delta` events) | RAG streams a mixed payload (sources known up front + text token-by-token); SSE's named events fit that better than a raw text stream |
| Ingestion | Async via `waitUntil` + `status` column + dedup hash | Decouples the upload response from the heavy embed step on a free-tier-friendly model; no queue or external worker |

---

## Features

- **Multi-format upload** — PDF and plain text files
- **Token-accurate chunking** — real `cl100k_base` token counts, sentence-aware with overlap; no chunk ever exceeds the token limit
- **Hybrid search** — vector similarity + Postgres full-text, fused with Reciprocal Rank Fusion
- **HNSW vector index** — high recall without query-time tuning
- **Similarity threshold** — avoids answering from irrelevant context
- **End-to-end streaming** — sources appear first, then the answer streams token by token over SSE
- **Source citations** — every answer references the document and excerpt it came from
- **Resilient ingestion** — content-hash dedup, `processing`/`ready`/`failed` status, background processing with front-end polling
- **Document management** — list and delete uploaded documents
- **Tested** — Vitest unit suite for the chunker and the rank-fusion logic

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 14 (App Router) |
| UI | Tailwind CSS |
| Vector + full-text DB | Supabase + pgvector (HNSW) |
| LLM | Anthropic Claude (`claude-sonnet-4-6`) |
| Embeddings | OpenAI (`text-embedding-3-small`) |
| Tokenizer | js-tiktoken (`cl100k_base`) |
| PDF parsing | pdf-parse |
| Background work | `@vercel/functions` (`waitUntil`) |
| Tests | Vitest |
| Deployment | Vercel (frontend) + Supabase (database) |

---

## Project Structure

```
rag-knowledge-base/
├── app/
│   ├── page.tsx                  # Main UI (holds document state + polling)
│   ├── components/
│   │   ├── UploadZone.tsx        # Drag-and-drop upload
│   │   ├── QueryInterface.tsx    # Question input + streaming answer + sources
│   │   └── DocumentList.tsx      # Document list with ingestion status badges
│   └── api/
│       ├── upload/route.ts       # Ingest: dedup → extract → (async) chunk/embed/store
│       ├── query/route.ts        # Query: embed → hybrid retrieve → stream (SSE)
│       └── documents/route.ts    # List and delete documents (also the polling endpoint)
├── lib/
│   ├── chunker.ts                # Token-accurate, sentence-aware chunking
│   ├── rrf.ts                    # Pure Reciprocal Rank Fusion (testable mirror of the SQL)
│   ├── embeddings.ts             # OpenAI embeddings + Claude generation
│   ├── supabase.ts               # Supabase client, dedup, status, hybrid search wrapper
│   └── pdf.ts                    # PDF text extraction
├── scripts/
│   ├── schema-full.sql           # Full schema: tables, owner_id, usage ledger, RLS, hybrid_search()
│   └── test_hybrid_search.sql    # Manual integration check for the SQL fusion
├── tests/
│   ├── chunker.test.ts           # Chunker invariants
│   └── rrf.test.ts               # Rank fusion + threshold + NaN regression
├── docs/
│   └── setup.md                  # Step-by-step setup guide
├── vitest.config.ts
├── .env.example
└── .gitignore
```

---

## Retrieval & Citation Logic

Each chunk stored in the database includes `document_id`, `chunk_index`, `content`, a 1536-dimension `embedding`, and a generated `content_tsv` (full-text vector kept in sync automatically).

At query time the system runs a single `hybrid_search` RPC that:
1. Vector-searches by cosine similarity over the HNSW index, dropping anything below the similarity threshold.
2. Full-text-searches the same chunks via `ts_rank`.
3. Fuses the two ranked lists with Reciprocal Rank Fusion and returns the top results.

The retrieved chunks are passed to Claude with explicit instructions to answer only from the provided context, cite the source document for each claim, and say it doesn't have enough information rather than hallucinate.

---

## Getting Started

See [docs/setup.md](docs/setup.md) for full instructions.

**Quick start:**
```bash
git clone https://github.com/lauuuer/rag-knowledge-base
cd rag-knowledge-base
npm install
cp .env.example .env.local
# Fill in your keys, run scripts/schema-full.sql in Supabase, then:
npm run dev
```

**Run the tests:**
```bash
npm test
```

---

## About

Built by Lucas — 10 years in project & operations management, now building AI-powered systems that solve the exact problems I spent a decade managing.

- [DM Booked](https://github.com/lauuuer/dmbooked) — AI Booking Agent SaaS (production)
- [LinkedIn](#) · [GitHub](https://github.com/lauuuer)
