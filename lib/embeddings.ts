import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * Embed a single string. Now returns the token usage alongside the vector so
 * the caller can bill the (small) embedding cost against the per-user cap.
 */
export async function embed(
  text: string
): Promise<{ embedding: number[]; tokens: number }> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  })
  return {
    embedding: response.data[0].embedding,
    tokens: response.usage?.total_tokens ?? 0,
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 100
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    })
    const sorted = response.data.sort((a, b) => a.index - b.index)
    results.push(...sorted.map(e => e.embedding))
  }

  return results
}

/**
 * Stream an answer from Claude. Unchanged from before except that we keep
 * max_tokens capped low (512) so the single most expensive possible query is
 * still a fraction of a cent — a cheap defense layer independent of who the
 * user is. The route reads `message.usage` off the final message event to bill
 * exact cost.
 */
export async function generateAnswer(
  question: string,
  context: { content: string; document_name: string; chunk_index: number }[]
) {
  const contextBlock = context
    .map(
      (c, i) =>
        `[Source ${i + 1}: "${c.document_name}", chunk ${c.chunk_index + 1}]\n${c.content}`
    )
    .join('\n\n---\n\n')

  const systemPrompt = `You are a precise Q&A assistant. Answer questions strictly based on the provided context.

Rules:
1. Answer only from the context below. Do not use prior knowledge.
2. Cite your sources: after each claim, reference the [Source N] it came from.
3. If the context does not contain enough information, say: "I don't have enough information in the uploaded documents to answer this."
4. Be concise and direct. Avoid restating the question.`

  const userMessage = `Context:\n\n${contextBlock}\n\n---\n\nQuestion: ${question}`

  return anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 512, // lowered from 1024: bounds worst-case per-query cost
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })
}
