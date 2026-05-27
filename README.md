# RAG Knowledge Base — Document Q&A System

A production-ready Retrieval-Augmented Generation (RAG) system. Upload documents (PDF or TXT), ask questions in natural language, and get accurate answers **with source citations** — grounded in your own content.

Built to demonstrate core AI engineering infrastructure: chunking, vector embeddings, semantic search, and LLM-powered response generation.

---

## Live Demo

**[rag-knowledge-base-peach.vercel.app](https://rag-knowledge-base-peach.vercel.app/)**

> Deploy your own in ~10 minutes. See [docs/setup.md](docs/setup.md).

---

## Architecture

```
User uploads PDF/TXT
        │
        ▼
[Next.js API Route /api/upload]
        │
        ├─► Extract raw text (pdf-parse / plain text)
        │
        ├─► Chunk text (512 tokens, 50-token overlap)
        │
        ├─► Generate embeddings (Claude claude-3-5-haiku-20241022)
        │
        └─► Store chunks + embeddings → Supabase (pgvector)

User submits question
        │
        ▼
[Next.js API Route /api/query]
        │
        ├─► Embed the question (same model)
        │
        ├─► Vector similarity search → top-K chunks (cosine distance)
        │
        ├─► Build prompt: system + retrieved context + question
        │
        ├─► Claude claude-3-5-sonnet-20241022 generates answer
        │
        └─► Return answer + source citations (document name + chunk excerpt)
```

### Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Vector store | Supabase pgvector | Managed Postgres — no separate infra, easy to self-host |
| Embedding model | `claude-3-5-haiku-20241022` | Fast, cheap, high quality for retrieval |
| Generation model | `claude-3-5-sonnet-20241022` | Best reasoning for synthesis across multiple chunks |
| Chunk size | 512 tokens / 50 overlap | Balances context richness with retrieval precision |
| Top-K retrieval | 5 chunks | Covers multi-section answers without exceeding context |
| Source citation | Included in every response | Production systems always cite — builds trust, enables verification |

---

## Features

- **Multi-format upload** — PDF and plain text files
- **Chunking with overlap** — preserves context across chunk boundaries
- **Semantic search** — finds relevant content even when wording differs
- **Source citations** — every answer references the document and excerpt it came from
- **Multi-document** — query across multiple uploaded documents simultaneously
- **Document management** — list and delete uploaded documents
- **Streaming responses** — answer streams token by token (no waiting)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 14 (App Router) |
| UI | Tailwind CSS |
| Vector Database | Supabase + pgvector |
| LLM + Embeddings | Anthropic Claude API |
| PDF Parsing | pdf-parse |
| Deployment | Vercel (frontend) + Supabase (database) |

---

## Project Structure

```
rag-knowledge-base/
├── app/
│   ├── page.tsx                  # Main UI
│   ├── components/
│   │   ├── UploadZone.tsx        # Drag-and-drop file upload
│   │   ├── QueryInterface.tsx    # Question input + answer display
│   │   └── DocumentList.tsx      # Uploaded documents list
│   └── api/
│       ├── upload/route.ts       # Ingest pipeline (extract → chunk → embed → store)
│       ├── query/route.ts        # Query pipeline (embed → retrieve → generate)
│       └── documents/route.ts    # List and delete documents
├── lib/
│   ├── chunker.ts                # Text chunking logic
│   ├── embeddings.ts             # Anthropic embeddings wrapper
│   ├── supabase.ts               # Supabase client + vector search
│   └── pdf.ts                    # PDF text extraction
├── scripts/
│   └── schema.sql                # Database schema (run once in Supabase)
├── docs/
│   └── setup.md                  # Step-by-step setup guide
├── .env.example
└── .gitignore
```

---

## Retrieval & Citation Logic

Each chunk stored in the database includes:
- `document_id` — links to the source document
- `chunk_index` — position within the document
- `content` — raw text of the chunk
- `embedding` — 1536-dimension float vector

At query time, the system runs a cosine similarity search, retrieves the top 5 chunks, and passes them to the LLM with explicit instructions to:
1. Answer only from provided context
2. Cite the source document name for each claim
3. Return `"I don't know"` if the context doesn't contain the answer (no hallucination)

---

## Getting Started

See [docs/setup.md](docs/setup.md) for full instructions.

**Quick start:**
```bash
git clone https://github.com/yourusername/rag-knowledge-base
cd rag-knowledge-base
npm install
cp .env.example .env.local
# Fill in your keys, run schema.sql in Supabase, then:
npm run dev
```

---

## About

Built by Lucas — 10 years in project & operations management, now building AI-powered systems that solve the exact problems I spent a decade managing.

- [DM Booked](https://github.com/lauuuer/dmbooked) — AI Booking Agent SaaS (production)
- [LinkedIn](#) · [GitHub](https://github.com/lauuuer)
