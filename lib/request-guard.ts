/**
 * Request-scoping + rate-limiting helpers shared by the API routes.
 *
 * Two concerns, deliberately simple for a free-tier single-instance demo:
 *
 * 1. Owner scoping. Each browser generates an anonymous owner id (client-side,
 *    persisted in localStorage) and sends it as `x-owner-id`. The routes scope
 *    every read/write to that id so one browser never sees or deletes another's
 *    documents. This is SESSION SCOPING, not authentication: a forged id would
 *    see that owner's data. Real isolation (auth + row-level security) is the
 *    documented production step — see HARDENING_NOTES.md.
 *
 * 2. Rate limiting. An in-memory sliding-window counter keyed by client IP.
 *    HONEST LIMITATION: serverless runs multiple instances, each with its own
 *    Map, so the effective limit is (configured limit × instance count), and the
 *    counters reset on cold start. This stops naive loops and accidental hammering
 *    — it is NOT a robust cost defense against a determined attacker rotating IPs.
 *    The real cost backstop is a provider-side spend cap (OpenAI/Anthropic), set
 *    out of band. See HARDENING_NOTES.md.
 */

const OWNER_HEADER = 'x-owner-id'

/** A well-formed owner id: the client generates a UUID; we accept that shape. */
const OWNER_ID_RE = /^[a-zA-Z0-9_-]{16,64}$/

/**
 * Extract and validate the owner id from a request. Returns null when missing or
 * malformed; routes turn that into a 400 rather than running unscoped.
 */
export function getOwnerId(req: Request): string | null {
  const raw = req.headers.get(OWNER_HEADER)
  if (!raw || !OWNER_ID_RE.test(raw)) return null
  return raw
}

/** Best-effort client IP from common proxy headers (Vercel sets x-forwarded-for). */
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  ok: boolean
  retryAfterSeconds: number
}

/**
 * Sliding-window-ish fixed-window limiter. `limit` requests per `windowMs` per
 * (route, ip). Opportunistically evicts expired buckets so the Map can't grow
 * without bound on a long-lived instance.
 */
export function rateLimit(
  req: Request,
  route: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now()
  const key = `${route}:${clientIp(req)}`

  // Opportunistic cleanup of expired buckets (cheap; bounded by Map size).
  if (buckets.size > 1000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
  }

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfterSeconds: 0 }
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) }
  }

  bucket.count++
  return { ok: true, retryAfterSeconds: 0 }
}
