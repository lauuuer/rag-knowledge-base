import { NextRequest, NextResponse } from 'next/server'
import { chunkText } from '@/lib/chunker'
import { embedBatch } from '@/lib/embeddings'
import { insertDocument, insertChunks, updateChunkCount } from '@/lib/supabase'
import { extractTextFromPDF } from '@/lib/pdf'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = ['application/pdf', 'text/plain']

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported file type. Only PDF and TXT are accepted.' },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10 MB.' },
        { status: 400 }
      )
    }

    // 1. Extract text
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    let rawText: string
    if (file.type === 'application/pdf') {
      rawText = await extractTextFromPDF(buffer)
    } else {
      rawText = buffer.toString('utf-8')
    }

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: 'Could not extract text from this file.' },
        { status: 422 }
      )
    }

    // 2. Insert document record
    const fileType = file.type === 'application/pdf' ? 'pdf' : 'txt'
    const documentId = await insertDocument({
      name: file.name,
      file_type: fileType,
      size_bytes: file.size,
      chunk_count: 0,
    })

    // 3. Chunk text
    const chunks = chunkText(rawText)

    // 4. Generate embeddings in batch
    const embeddings = await embedBatch(chunks)

    // 5. Store chunks
    await insertChunks(
      chunks.map((content, i) => ({
        document_id: documentId,
        chunk_index: i,
        content,
        embedding: embeddings[i],
      }))
    )

    // 6. Update chunk count
    await updateChunkCount(documentId, chunks.length)

    return NextResponse.json({
      success: true,
      document: {
        id: documentId,
        name: file.name,
        chunk_count: chunks.length,
      },
    })
  } catch (err) {
    console.error('[upload] error:', err)
    return NextResponse.json(
      { error: 'Internal server error during ingestion.' },
      { status: 500 }
    )
  }
}
