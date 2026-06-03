import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { waitUntil } from '@vercel/functions'
import { chunkText } from '@/lib/chunker'
import { embedBatch } from '@/lib/embeddings'
import {
  insertDocument,
  insertChunks,
  setDocumentStatus,
  findDocumentByHash,
} from '@/lib/supabase'
import { extractTextFromPDF } from '@/lib/pdf'
import { getAuthedUser, precheckSpend } from '@/lib/auth'
import { rateLimit } from '@/lib/request-guard'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = ['application/pdf', 'text/plain']
const UPLOAD_LIMIT = 20 // uploads per minute per IP (secondary, best-effort layer)
const WINDOW_MS = 60_000

export async function POST(req: NextRequest) {
  try {
    // Verified identity replaces the old owner header.
    const user = await getAuthedUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Please sign in to upload.' }, { status: 401 })
    }
    const ownerId = user.id

    // If a user has already blown their cap, don't let them keep ingesting
    // (embeddings cost money too). Blocked users are stopped here as well.
    const pre = await precheckSpend(ownerId)
    if (pre.blocked) {
      return NextResponse.json({ error: 'This account has been blocked.' }, { status: 403 })
    }
    if (pre.overCap) {
      return NextResponse.json(
        { error: 'Demo usage limit reached for this account.', code: 'SPEND_CAP_REACHED' },
        { status: 402 }
      )
    }

    // Keep the IP rate limiter as a cheap secondary guard against rapid loops.
    const rl = rateLimit(req, 'upload', UPLOAD_LIMIT, WINDOW_MS)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      )
    }

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

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const contentHash = createHash('sha256').update(buffer).digest('hex')
    const existing = await findDocumentByHash(contentHash, ownerId)
    if (existing) {
      return NextResponse.json({
        success: true,
        deduplicated: true,
        document: {
          id: existing.id,
          name: existing.name,
          status: existing.status,
          chunk_count: existing.chunk_count,
        },
      })
    }

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

    const fileType = file.type === 'application/pdf' ? 'pdf' : 'txt'
    const documentId = await insertDocument({
      name: file.name,
      file_type: fileType,
      size_bytes: file.size,
      status: 'processing',
      content_hash: contentHash,
      owner_id: ownerId,
    })

    waitUntil(processDocument(documentId, rawText))

    return NextResponse.json({
      success: true,
      document: { id: documentId, name: file.name, status: 'processing' },
    })
  } catch (err) {
    console.error('[upload] error:', err)
    return NextResponse.json(
      { error: 'Internal server error during ingestion.' },
      { status: 500 }
    )
  }
}

async function processDocument(documentId: string, rawText: string): Promise<void> {
  try {
    const chunks = chunkText(rawText)
    if (chunks.length === 0) {
      await setDocumentStatus(documentId, 'failed', {
        error_message: 'No chunks produced from document text.',
      })
      return
    }

    const embeddings = await embedBatch(chunks)

    await insertChunks(
      chunks.map((content, i) => ({
        document_id: documentId,
        chunk_index: i,
        content,
        embedding: embeddings[i],
      }))
    )

    await setDocumentStatus(documentId, 'ready', { chunk_count: chunks.length })
  } catch (err) {
    console.error('[upload] background processing failed:', err)
    const message = err instanceof Error ? err.message : 'Unknown processing error'
    try {
      await setDocumentStatus(documentId, 'failed', { error_message: message })
    } catch (statusErr) {
      console.error('[upload] failed to mark document failed:', statusErr)
    }
  }
}
