/**
 * Cost accounting. Converts measured token usage into micros (millionths of a
 * US dollar) so the per-user ledger can accumulate fractions of a cent without
 * floating-point drift.
 *
 * Prices are per MILLION tokens, in USD, and are configurable via env so a
 * price change never requires a code edit. Defaults reflect public list prices
 * as of mid-2026:
 *   - Anthropic Claude Sonnet (4.x):      $3.00 input / $15.00 output per 1M
 *   - OpenAI text-embedding-3-small:      $0.02 per 1M tokens
 * Verify against the providers' current pricing pages and adjust the env vars
 * if they change.
 *
 * We price embeddings too, even though they're cheap, because the query path
 * embeds every question — it's a real (small) per-query cost and counting it
 * keeps the cap honest.
 */

const USD_PER_M_SONNET_IN = Number(process.env.PRICE_SONNET_INPUT_PER_M ?? '3.00')
const USD_PER_M_SONNET_OUT = Number(process.env.PRICE_SONNET_OUTPUT_PER_M ?? '15.00')
const USD_PER_M_EMBED = Number(process.env.PRICE_EMBED_PER_M ?? '0.02')

const MICROS_PER_USD = 1_000_000

/** Cost of one Anthropic generation, in micros, from its token usage. */
export function generationCostMicros(inputTokens: number, outputTokens: number): number {
  const usd =
    (inputTokens / 1_000_000) * USD_PER_M_SONNET_IN +
    (outputTokens / 1_000_000) * USD_PER_M_SONNET_OUT
  return Math.round(usd * MICROS_PER_USD)
}

/** Cost of embedding `tokens` tokens with the small embedding model, in micros. */
export function embeddingCostMicros(tokens: number): number {
  const usd = (tokens / 1_000_000) * USD_PER_M_EMBED
  return Math.round(usd * MICROS_PER_USD)
}

/**
 * Fallback estimate when an embedding response doesn't return usage: assume
 * ~4 characters per token. Rough, but embeddings are so cheap the error is
 * negligible against the cap.
 */
export function estimateTokensFromChars(text: string): number {
  return Math.ceil(text.length / 4)
}

export function microsToUsdString(micros: number): string {
  return `$${(micros / MICROS_PER_USD).toFixed(4)}`
}
