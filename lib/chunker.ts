import { getEncoding, type Tiktoken } from 'js-tiktoken'

// cl100k_base is the tokenizer used by text-embedding-3-small (our embedding
// model). Token counts are model-specific; this matches the OpenAI provider.
// Created once and reused — constructing the encoder parses a large table.
let _enc: Tiktoken | null = null
function enc(): Tiktoken {
  if (!_enc) _enc = getEncoding('cl100k_base')
  return _enc
}

/** Real token count for a string. */
export function countTokens(text: string): number {
  return enc().encode(text).length
}

/**
 * Split text into overlapping chunks sized by REAL token count.
 *
 * Strategy: pack whole sentences into a chunk until adding the next sentence
 * would exceed `maxTokens`, then start a new chunk that begins with an overlap
 * of the previous chunk's trailing sentences. Safety net: a single sentence
 * longer than `maxTokens` (code blocks, tables, unpunctuated text) is hard-split
 * by tokens so no chunk ever exceeds the limit.
 *
 * @param text      Full document text
 * @param maxTokens Max tokens per chunk (default 512)
 * @param overlap   Approx overlap tokens carried into the next chunk (default 50)
 */
export function chunkText(
  text: string,
  maxTokens: number = 512,
  overlap: number = 50
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!normalized) return []

  if (countTokens(normalized) <= maxTokens) {
    return [normalized]
  }

  const sentences = splitIntoSentences(normalized)
  const chunks: string[] = []

  let current: string[] = []        // sentences in the chunk being built
  let currentTokens = 0

  const flush = () => {
    if (current.length === 0) return
    chunks.push(current.join(' ').trim())
  }

  for (const sentence of sentences) {
    const sentTokens = countTokens(sentence)

    // Case 1: a single sentence is itself too big — hard-split it by tokens.
    if (sentTokens > maxTokens) {
      flush()
      current = []
      currentTokens = 0
      for (const piece of hardSplitByTokens(sentence, maxTokens)) {
        chunks.push(piece)
      }
      continue
    }

    // Case 2: adding this sentence would overflow — close the current chunk,
    // then seed the next one with a token-bounded overlap tail.
    if (currentTokens + sentTokens > maxTokens && current.length > 0) {
      flush()
      const tail = takeOverlapTail(current, overlap)
      current = [...tail]
      currentTokens = tail.reduce((sum, s) => sum + countTokens(s), 0)
    }

    current.push(sentence)
    currentTokens += sentTokens
  }

  flush()
  return chunks.filter(c => c.length > 0)
}

/** Split on sentence-ending punctuation followed by whitespace, keeping the punctuation. */
function splitIntoSentences(text: string): string[] {
  // Split after . ! ? when followed by space/newline. Keeps reasonable boundaries
  // without a full NLP sentence tokenizer (good enough for chunking).
  const parts = text.split(/(?<=[.!?])\s+/)
  return parts.map(s => s.trim()).filter(Boolean)
}

/** Take trailing sentences from a chunk until ~`overlap` tokens are collected. */
function takeOverlapTail(sentences: string[], overlap: number): string[] {
  if (overlap <= 0) return []
  const tail: string[] = []
  let tokens = 0
  for (let i = sentences.length - 1; i >= 0; i--) {
    const t = countTokens(sentences[i])
    if (tokens + t > overlap && tail.length > 0) break
    tail.unshift(sentences[i])
    tokens += t
  }
  return tail
}

/** Hard-split an over-long string into <= maxTokens pieces, decoding back to text. */
function hardSplitByTokens(text: string, maxTokens: number): string[] {
  const e = enc()
  const tokens = e.encode(text)
  const pieces: string[] = []
  for (let i = 0; i < tokens.length; i += maxTokens) {
    const slice = tokens.slice(i, i + maxTokens)
    pieces.push(e.decode(slice).trim())
  }
  return pieces.filter(Boolean)
}
