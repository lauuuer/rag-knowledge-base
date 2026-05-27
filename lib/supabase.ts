import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseServiceKey)

export interface Document {
  id: string
  name: string
  file_type: string
  size_bytes: number
  chunk_count: number
  created_at: string
}

export interface Chunk {
  id: string
  document_id: string
  chunk_index: number
  content: string
  similarity: number
  document_name: string
}

export async function insertDocument(doc: Omit<Document, 'id' | 'created_at'>): Promise<string> {
  const { data, error } = await supabase
    .from('documents')
    .insert(doc)
    .select('id')
    .single()

  if (error) throw new Error(`Failed to insert document: ${error.message}`)
  return data.id
}

export async function insertChunks(
  chunks: { document_id: string; chunk_index: number; content: string; embedding: number[] }[]
) {
  const BATCH_SIZE = 100
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    const formatted = batch.map(c => ({
      ...c,
      embedding: `[${c.embedding.join(',')}]`,
    }))
    const { error } = await supabase.from('chunks').insert(formatted)
    if (error) throw new Error(`Failed to insert chunks: ${error.message}`)
  }
}

export async function updateChunkCount(documentId: string, count: number) {
  const { error } = await supabase
    .from('documents')
    .update({ chunk_count: count })
    .eq('id', documentId)

  if (error) throw new Error(`Failed to update chunk count: ${error.message}`)
}

export async function searchChunks(
  queryEmbedding: number[],
  topK: number = 5
): Promise<Chunk[]> {
  const embeddingString = `[${queryEmbedding.join(',')}]`

  const { data, error } = await supabase.rpc('search_chunks_by_text', {
    query_embedding: embeddingString,
    match_count: topK,
  })

  if (error) throw new Error(`Vector search failed: ${error.message}`)
  return data as Chunk[]
}

export async function listDocuments(): Promise<Document[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list documents: ${error.message}`)
  return data as Document[]
}

export async function deleteDocument(documentId: string) {
  const { error } = await supabase.from('documents').delete().eq('id', documentId)
  if (error) throw new Error(`Failed to delete document: ${error.message}`)
}
