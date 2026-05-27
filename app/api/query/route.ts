import { NextRequest, NextResponse } from 'next/server'
import { embed, generateAnswer } from '@/lib/embeddings'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { question } = body

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json({ error: 'Question is required.' }, { status: 400 })
    }

    const queryEmbedding = await embed(question.trim())
    const embeddingString = `[${queryEmbedding.join(',')}]`

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await supabase.rpc('search_chunks_by_text', {
      query_embedding: embeddingString,
      match_count: 5,
    })

    if (error) {
      console.error('[query] rpc error:', error)
      return NextResponse.json({ error: 'Search failed: ' + error.message }, { status: 500 })
    }

    const chunks = data || []

    if (chunks.length === 0) {
      return NextResponse.json({
        answer: "I don't have enough information in the uploaded documents to answer this.",
        sources: [],
      })
    }

    const sources = chunks.map((c: any) => ({
      document_name: c.document_name,
      chunk_index: c.chunk_index,
      excerpt: c.content.slice(0, 200) + (c.content.length > 200 ? '…' : ''),
      similarity: Math.round(c.similarity * 100) / 100,
    }))

    const stream = await generateAnswer(question, chunks)
    let fullAnswer = ''
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullAnswer += event.delta.text
      }
    }

    return NextResponse.json({ answer: fullAnswer, sources })

  } catch (err) {
    console.error('[query] error:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
