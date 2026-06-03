-- Reproducible smoke test for hybrid_search (run against a pgvector DB).
-- Uses 4-dim vectors for hand-verifiability. Adapt the schema to vector(4) first,
-- or run on a throwaway DB. Validates: RRF fusion, similarity threshold, NaN guard.

insert into documents (id, name, file_type, size_bytes, chunk_count, owner_id)
values ('11111111-1111-1111-1111-111111111111', 'test.txt', 'txt', 100, 5, 'test-owner');

insert into chunks (document_id, chunk_index, content, embedding) values
('11111111-1111-1111-1111-111111111111', 0, 'The database connection failed with error ECONNREFUSED on startup', '[1,0,0,0]'),
('11111111-1111-1111-1111-111111111111', 1, 'Network sockets and TCP connections explained in depth', '[0.9,0.1,0,0]'),
('11111111-1111-1111-1111-111111111111', 2, 'A guide to cooking pasta and italian cuisine', '[0,1,0,0]'),
('11111111-1111-1111-1111-111111111111', 3, 'Postgres performance tuning for large tables', '[0,0,1,0]'),
('11111111-1111-1111-1111-111111111111', 4, 'The ECONNREFUSED error means the port is closed', '[0,0,0,1]');

-- Expect: chunk 0 top (strong in BOTH lists), chunk 4 second (exact FTS term),
-- pasta (chunk 2) pushed down despite a non-trivial vector score.
\echo 'EXPECT chunk 0 then 4 at top:'
select chunk_index, round(rrf_score::numeric,5) rrf
from hybrid_search('[0.95,0.05,0,0]', 'ECONNREFUSED error', 'test-owner', 5, 0.0, 60, 30);

-- Expect: 0 rows. Irrelevant query + threshold 0.3 must return nothing.
\echo 'EXPECT 0 rows:'
select count(*) from hybrid_search('[0,0,0,0]', 'zzz nonexistent xyzzy', 'test-owner', 5, 0.3, 60, 30);

-- Expect: 2 rows (chunks 0,1 above threshold).
\echo 'EXPECT 2 rows:'
select count(*) from hybrid_search('[0.95,0.05,0,0]', 'something', 'test-owner', 5, 0.3, 60, 30);
