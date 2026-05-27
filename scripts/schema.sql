-- RAG Knowledge Base — Database Schema
-- Run this in the Supabase SQL Editor (once, before first use)

-- Enable the pgvector extension
create extension if not exists vector;

-- Documents table
create table documents (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  file_type   text not null check (file_type in ('pdf', 'txt')),
  size_bytes  integer not null,
  chunk_count integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Chunks table with 1536-dimension vector (OpenAI text-embedding-3-small)
create table chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index integer not null,
  content     text not null,
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);

-- Index for fast similarity search
create index on chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index on chunks (document_id);

-- Search function (accepts embedding as text to avoid SDK serialization issues)
create or replace function search_chunks_by_text(
  query_embedding text,
  match_count int default 5
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  similarity float,
  document_name text
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.document_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding::vector) as similarity,
    d.name as document_name
  from chunks c
  join documents d on d.id = c.document_id
  where c.embedding is not null
  order by c.embedding <=> query_embedding::vector
  limit match_count;
end;
$$;

-- Grant permissions
grant execute on function search_chunks_by_text(text, int) to service_role;
grant select on chunks to service_role;
grant select on documents to service_role;
