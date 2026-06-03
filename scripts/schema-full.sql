-- ============================================================================
-- RAG Knowledge Base — FULL SCHEMA (fresh install, auth-ready)
--
-- Use this when starting from an EMPTY database. It creates everything in one
-- pass: documents + chunks, the hybrid_search function, the per-user usage
-- ledger with spend caps, and Row-Level Security — already wired for verified
-- Supabase Auth users.
--
-- Run ONCE in the Supabase SQL Editor. Do NOT also run the old schema.sql or
-- migration-auth.sql — this file replaces both.
--
-- Note on owner_id: it's a text column that the API fills with auth.uid() (the
-- verified user id). No anonymous ids ever exist in a fresh install.
-- ============================================================================

create extension if not exists vector;

-- ----------------------------------------------------------------------------
-- documents
-- ----------------------------------------------------------------------------
create table documents (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  file_type    text not null check (file_type in ('pdf', 'txt')),
  size_bytes   integer not null,
  chunk_count  integer not null default 0,
  status       text not null default 'processing'
                 check (status in ('processing', 'ready', 'failed')),
  error_message text,
  -- Verified Supabase Auth user id (auth.uid()), stored as text. Scopes every
  -- row to its owner.
  owner_id     text not null,
  -- SHA-256 of file CONTENT, for per-owner dedup.
  content_hash text,
  created_at   timestamptz not null default now(),
  unique (owner_id, content_hash)
);

-- ----------------------------------------------------------------------------
-- chunks
-- ----------------------------------------------------------------------------
create table chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index integer not null,
  content     text not null,
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);

-- HNSW vector index (high recall, no per-query tuning).
create index on chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index on chunks (document_id);

-- Full-text column + index for hybrid retrieval.
alter table chunks
  add column content_tsv tsvector
  generated always as (to_tsvector('english', content)) stored;

create index on chunks using gin (content_tsv);

create index on documents (owner_id);

grant select on chunks to service_role;
grant select on documents to service_role;

-- ----------------------------------------------------------------------------
-- hybrid_search (vector + FTS fused with Reciprocal Rank Fusion)
-- ----------------------------------------------------------------------------
create or replace function hybrid_search(
  query_embedding  text,
  query_text       text,
  owner            text,
  match_count      int   default 5,
  min_similarity   float default 0.3,
  rrf_k            int   default 60,
  candidate_pool   int   default 30
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  similarity float,
  rrf_score float,
  document_name text
)
language sql
as $$
  with vector_results as (
    select
      c.id,
      1 - (c.embedding <=> query_embedding::vector) as similarity,
      row_number() over (
        order by c.embedding <=> query_embedding::vector
      ) as rank
    from chunks c
    join documents d on d.id = c.document_id
    where c.embedding is not null
      and d.owner_id = owner
      and (1 - (c.embedding <=> query_embedding::vector)) <> 'NaN'::float8
      and (1 - (c.embedding <=> query_embedding::vector)) >= min_similarity
    order by c.embedding <=> query_embedding::vector
    limit candidate_pool
  ),
  fts_results as (
    select
      c.id,
      row_number() over (
        order by ts_rank(c.content_tsv, websearch_to_tsquery('english', query_text)) desc
      ) as rank
    from chunks c
    join documents d on d.id = c.document_id
    where d.owner_id = owner
      and c.content_tsv @@ websearch_to_tsquery('english', query_text)
    limit candidate_pool
  ),
  fused as (
    select
      coalesce(v.id, f.id) as id,
      coalesce(1.0 / (rrf_k + v.rank), 0.0)
        + coalesce(1.0 / (rrf_k + f.rank), 0.0) as rrf_score,
      v.similarity
    from vector_results v
    full outer join fts_results f on v.id = f.id
  )
  select
    c.id,
    c.document_id,
    c.chunk_index,
    c.content,
    coalesce(fused.similarity, 0.0) as similarity,
    fused.rrf_score,
    d.name as document_name
  from fused
  join chunks c on c.id = fused.id
  join documents d on d.id = c.document_id
  order by fused.rrf_score desc
  limit match_count;
$$;

grant execute on function hybrid_search(text, text, text, int, float, int, int) to service_role;

-- ----------------------------------------------------------------------------
-- usage ledger + spend functions
-- ----------------------------------------------------------------------------
-- spent_micros = cost in millionths of a USD ($0.10 = 100000 micros).
create table usage (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  spent_micros  bigint  not null default 0,
  query_count   integer not null default 0,
  blocked       boolean not null default false,
  first_seen    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

grant select, insert, update on usage to service_role;

-- Atomic spend recorder: upsert + add cost + return new total / over-cap flag.
create or replace function record_spend(
  p_user_id     uuid,
  p_cost_micros bigint,
  p_cap_micros  bigint
)
returns table (total_micros bigint, over_cap boolean, blocked boolean)
language plpgsql
as $$
declare
  v_total   bigint;
  v_blocked boolean;
begin
  insert into usage (user_id, spent_micros, query_count)
    values (p_user_id, greatest(p_cost_micros, 0), 1)
  on conflict (user_id) do update
    set spent_micros = usage.spent_micros + greatest(p_cost_micros, 0),
        query_count  = usage.query_count + 1,
        updated_at   = now()
  returning usage.spent_micros, usage.blocked
    into v_total, v_blocked;

  return query select v_total, (v_total >= p_cap_micros), v_blocked;
end;
$$;

grant execute on function record_spend(uuid, bigint, bigint) to service_role;

-- Free read-only pre-check used before calling any paid model.
create or replace function check_spend(
  p_user_id    uuid,
  p_cap_micros bigint
)
returns table (total_micros bigint, over_cap boolean, blocked boolean)
language sql
stable
as $$
  select
    coalesce(u.spent_micros, 0),
    coalesce(u.spent_micros, 0) >= p_cap_micros,
    coalesce(u.blocked, false)
  from (select 1) _
  left join usage u on u.user_id = p_user_id;
$$;

grant execute on function check_spend(uuid, bigint) to service_role;

-- ----------------------------------------------------------------------------
-- Row-Level Security (defense in depth; service role bypasses it)
-- ----------------------------------------------------------------------------
alter table documents enable row level security;
alter table chunks    enable row level security;
alter table usage     enable row level security;

create policy documents_owner_select on documents
  for select using (owner_id = (select auth.uid())::text);
create policy documents_owner_insert on documents
  for insert with check (owner_id = (select auth.uid())::text);
create policy documents_owner_delete on documents
  for delete using (owner_id = (select auth.uid())::text);

create policy chunks_owner_select on chunks
  for select using (
    exists (
      select 1 from documents d
      where d.id = chunks.document_id
        and d.owner_id = (select auth.uid())::text
    )
  );

create policy usage_owner_select on usage
  for select using (user_id = (select auth.uid()));
