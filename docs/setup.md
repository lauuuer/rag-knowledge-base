# Setup Guide

Get this project running locally in ~10 minutes.

---

## Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)
- A [Supabase](https://supabase.com/) account (free tier works)

---

## 1. Clone and install

```bash
git clone https://github.com/yourusername/rag-knowledge-base
cd rag-knowledge-base
npm install
```

---

## 2. Set up Supabase

1. Go to [supabase.com](https://supabase.com/) and create a new project
2. Wait for the project to finish provisioning (~1 minute)
3. In the sidebar, go to **SQL Editor**
4. Paste the contents of [`scripts/schema-full.sql`](../scripts/schema-full.sql) and click **Run**

This creates:
- `documents` table
- `chunks` table with a `vector(1536)` column
- `ivfflat` index for fast similarity search
- `match_chunks` RPC function

5. Go to **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role secret** key → `SUPABASE_SERVICE_ROLE_KEY`

---

## 3. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:

```env
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

> ⚠️ Never commit `.env.local` to version control. It's already in `.gitignore`.

---

## 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 5. Test it

1. Upload a PDF or TXT file using the left panel
2. Wait for the "X chunks" confirmation (processing takes a few seconds)
3. Ask a question in the chat panel
4. The answer will stream in with source citations below it

---

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Add all four environment variables in the Vercel dashboard under **Settings → Environment Variables**.

Supabase is already hosted — no additional backend deployment needed.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `pgvector extension not found` | Run `create extension if not exists vector;` in Supabase SQL Editor |
| `match_chunks function not found` | Re-run `scripts/schema-full.sql` in full |
| Embeddings returning wrong dimensions | Voyage-3 returns 1024-dim vectors. If you changed the schema to `vector(1536)`, update it to `vector(1024)` |
| Upload fails silently | Check server logs (`npm run dev` terminal) for the error detail |

---

## Architecture notes

See the [README](../README.md) for full architecture diagram and design decisions.
