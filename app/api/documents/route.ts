import { NextRequest, NextResponse } from 'next/server'
import { listDocuments, deleteDocument } from '@/lib/supabase'
import { getAuthedUser } from '@/lib/auth'
import { rateLimit } from '@/lib/request-guard'

const LIST_LIMIT = 120
const DELETE_LIMIT = 30
const WINDOW_MS = 60_000

export async function GET(req: NextRequest) {
  const user = await getAuthedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  }
  const ownerId = user.id

  const rl = rateLimit(req, 'documents:get', LIST_LIMIT, WINDOW_MS)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    )
  }

  try {
    const documents = await listDocuments(ownerId)
    return NextResponse.json({ documents })
  } catch (err) {
    console.error('[documents] GET error:', err)
    return NextResponse.json({ error: 'Failed to list documents.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  }
  const ownerId = user.id

  const rl = rateLimit(req, 'documents:delete', DELETE_LIMIT, WINDOW_MS)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    )
  }

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Document id is required.' }, { status: 400 })
    }

    const deleted = await deleteDocument(id, ownerId)
    if (!deleted) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[documents] DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete document.' }, { status: 500 })
  }
}
