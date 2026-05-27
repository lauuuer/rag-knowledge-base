import { NextRequest, NextResponse } from 'next/server'
import { listDocuments, deleteDocument } from '@/lib/supabase'

export async function GET() {
  try {
    const documents = await listDocuments()
    return NextResponse.json({ documents })
  } catch (err) {
    console.error('[documents] GET error:', err)
    return NextResponse.json({ error: 'Failed to list documents.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Document id is required.' }, { status: 400 })
    }

    await deleteDocument(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[documents] DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete document.' }, { status: 500 })
  }
}
