import { NextRequest } from 'next/server'
import { embed, generateAnswer } from '@/lib/embeddings'
import { createClient } from '@supabase/supabase-js'
import {
  getAuthedUser,
  precheckSpend,
  recordSpend,
  SPEND_CAP_USD,
} from '@/lib/auth'
import {
  generationCostMicros,
  embeddingCostMicros,
  microsToUsdString,
} from '@/lib/cost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const encoder = new TextEncoder()

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: NextRequest) {
  // --- 1. Authenticate. The verified user id replaces the old owner header. ---
  const user = await getAuthedUser(req)
  if (!user) {
    return Response.json({ error: 'Please sign in to ask questions.' }, { status: 401 })
  }
  const ownerId = user.id

  // --- 2. Spend pre-check BEFORE spending anything. An over-cap or blocked
  //        user is rejected for free. This is the per-person limit that keeps a
  //        single abuser from draining the budget for everyone else. ---
  const pre = await precheckSpend(ownerId)
  if (pre.blocked) {
    return Response.json({ error: 'This account has been blocked.' }, { status: 403 })
  }
  if (pre.overCap) {
    return Response.json(
      {
        error: `You've reached the ${'$'}${SPEND_CAP_USD.toFixed(
          2
        )} demo usage limit for this account. Thanks for trying it out!`,
        code: 'SPEND_CAP_REACHED',
      },
      { status: 402 } // 402 Payment Required — semantically apt for a spend cap
    )
  }

  // --- 3. Validate input. ---
  let question: string
  try {
    const body = await req.json()
    question = body?.question
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return Response.json({ error: 'Question is required.' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  question = question.trim()

  // Hard cap question length: a defense-in-depth bound on input cost.
  if (question.length > 2000) {
    return Response.json({ error: 'Question is too long (2000 char max).' }, { status: 400 })
  }

  // Track cost incrementally so we can bill even if the stream is cut short.
  let accumulatedMicros = 0

  // --- 4. Retrieval (embed the question, then hybrid search). ---
  let chunks: any[]
  try {
    const { embedding: queryEmbedding, tokens: embedTokens } = await embed(question)
    accumulatedMicros += embeddingCostMicros(embedTokens)

    const embeddingString = `[${queryEmbedding.join(',')}]`

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await supabase.rpc('hybrid_search', {
      query_embedding: embeddingString,
      query_text: question,
      owner: ownerId, // verified user id scopes retrieval
      match_count: 5,
      min_similarity: 0.3,
      rrf_k: 60,
      candidate_pool: 30,
    })

    if (error) {
      console.error('[query] rpc error:', error)
      // Bill the embedding we already spent before bailing.
      await recordSpend(ownerId, accumulatedMicros)
      return Response.json({ error: 'Search failed: ' + error.message }, { status: 500 })
    }
    chunks = data || []
  } catch (err) {
    console.error('[query] retrieval error:', err)
    await recordSpend(ownerId, accumulatedMicros)
    return Response.json({ error: 'Retrieval failed.' }, { status: 500 })
  }

  const sources = chunks.map((c: any) => ({
    document_name: c.document_name,
    chunk_index: c.chunk_index,
    excerpt: c.content.slice(0, 200) + (c.content.length > 200 ? '…' : ''),
    similarity: Math.round(c.similarity * 100) / 100,
  }))

  // --- 5. Stream. ---
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(sse('sources', sources))

        if (chunks.length === 0) {
          // No model call; just bill the embedding and finish.
          await recordSpend(ownerId, accumulatedMicros)
          controller.enqueue(
            sse('delta', {
              text: "I don't have enough information in the uploaded documents to answer this.",
            })
          )
          controller.enqueue(sse('done', {}))
          controller.close()
          return
        }

        const modelStream = await generateAnswer(question, chunks)
        for await (const event of modelStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(sse('delta', { text: event.delta.text }))
          }
        }

        // Exact generation cost from the SDK's final usage numbers.
        const finalMessage = await modelStream.finalMessage()
        accumulatedMicros += generationCostMicros(
          finalMessage.usage.input_tokens,
          finalMessage.usage.output_tokens
        )

        // Record total spend; tell the client if this query tipped them over so
        // the UI can show a friendly "you've hit the limit" state next time.
        const status = await recordSpend(ownerId, accumulatedMicros)

        controller.enqueue(
          sse('done', {
            spent: microsToUsdString(status.totalMicros),
            capReached: status.overCap,
          })
        )
        controller.close()
      } catch (err) {
        console.error('[query] stream error:', err)
        // Best-effort: bill whatever we accumulated so a mid-stream crash can't
        // be used to get free generations.
        try {
          await recordSpend(ownerId, accumulatedMicros)
        } catch {
          /* logged above */
        }
        controller.enqueue(sse('error', { message: 'Generation failed mid-stream.' }))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
