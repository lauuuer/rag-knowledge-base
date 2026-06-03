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
  status: 'processing' | 'ready' | 'failed'
  error_message: string | null
  content_hash: string | null
  owner_id: string
  created_at: string
}

export async function insertDocument(
  doc: Pick<Document, 'name' | 'file_type' | 'size_bytes' | 'owner_id'> &
    Partial<Pick<Document, 'chunk_count' | 'status' | 'content_hash'>>
): Promise<string> {
  const { data, error } = await supabase
    .from('documents')
    .insert(doc)
    .select('id')
    .single()

  if (error) {
    // Race: another request inserted the same (owner_id, content_hash) between our
    // dedup check and this insert. Postgres unique violation is code 23505. Recover
    // by returning the existing row instead of failing the upload.
    if (error.code === '23505' && doc.content_hash) {
      const existing = await findDocumentByHash(doc.content_hash, doc.owner_id)
      if (existing) return existing.id
    }
    throw new Error(`Failed to insert document: ${error.message}`)
  }
  return data.id
}

/** Dedup lookup: returns this owner's document with this content hash, if any. */
export async function findDocumentByHash(
  contentHash: string,
  ownerId: string
): Promise<Document | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('content_hash', contentHash)
    .eq('owner_id', ownerId)
    .maybeSingle()

  if (error) throw new Error(`Hash lookup failed: ${error.message}`)
  return (data as Document) ?? null
}

/** Flip a document's ingestion status (and optionally chunk_count / error). */
export async function setDocumentStatus(
  documentId: string,
  status: Document['status'],
  extra: { chunk_count?: number; error_message?: string } = {}
) {
  const { error } = await supabase
    .from('documents')
    .update({ status, ...extra })
    .eq('id', documentId)

  if (error) throw new Error(`Failed to set document status: ${error.message}`)
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

export async function listDocuments(ownerId: string): Promise<Document[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list documents: ${error.message}`)
  return data as Document[]
}

/**
 * Delete a document, but only if it belongs to `ownerId`. The owner filter is
 * part of the WHERE clause, so a request carrying a different owner deletes
 * nothing (rather than relying on the caller to check ownership first).
 * Returns true if a row was deleted, false if none matched (wrong owner or gone).
 */
export async function deleteDocument(documentId: string, ownerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)
    .eq('owner_id', ownerId)
    .select('id')

  if (error) throw new Error(`Failed to delete document: ${error.message}`)
  return (data?.length ?? 0) > 0
}
