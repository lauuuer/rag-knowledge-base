/**
 * Splits text into overlapping chunks.
 *
 * Strategy: character-based approximation of token count (1 token ≈ 4 chars).
 * Splits on sentence boundaries where possible to preserve coherence.
 *
 * @param text      Full document text
 * @param maxTokens Max tokens per chunk (default 512)
 * @param overlap   Overlap tokens between consecutive chunks (default 50)
 */
export function chunkText(
  text: string,
  maxTokens: number = 512,
  overlap: number = 50
): string[] {
  const maxChars = maxTokens * 4
  const overlapChars = overlap * 4

  // Normalize whitespace
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

  if (normalized.length <= maxChars) {
    return [normalized]
  }

  const chunks: string[] = []
  let start = 0

  while (start < normalized.length) {
    let end = start + maxChars

    if (end >= normalized.length) {
      chunks.push(normalized.slice(start).trim())
      break
    }

    // Try to split on a sentence boundary (. ! ?) within the last 20% of the chunk
    const searchFrom = start + Math.floor(maxChars * 0.8)
    const slice = normalized.slice(searchFrom, end)
    const sentenceEnd = slice.search(/[.!?]\s/)

    if (sentenceEnd !== -1) {
      end = searchFrom + sentenceEnd + 1
    } else {
      // Fall back to word boundary
      const lastSpace = normalized.lastIndexOf(' ', end)
      if (lastSpace > start) end = lastSpace
    }

    chunks.push(normalized.slice(start, end).trim())
    start = end - overlapChars
  }

  return chunks.filter(c => c.length > 0)
}
