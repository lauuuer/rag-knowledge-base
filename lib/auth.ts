/**
 * Server-side authentication + per-user spend enforcement.
 *
 * This REPLACES the trust model in the old lib/request-guard.ts. Previously the
 * "owner" was whatever UUID the browser put in an `x-owner-id` header — forgeable
 * by anyone. Now the browser sends a Supabase session JWT in the standard
 * `Authorization: Bearer <token>` header, and we VERIFY it server-side with the
 * Supabase admin client. The returned user id is cryptographically trustworthy:
 * it cannot be forged without Supabase's signing key.
 *
 * The verified user id is then used as `owner_id` everywhere the old code used
 * the anonymous id, so the rest of the data model is unchanged — only its source
 * of truth moved from "client claim" to "verified identity".
 *
 * It also centralizes the spend cap: a per-USER ceiling (shared across Google
 * and GitHub logins, because both resolve to one Supabase user id) that, once
 * crossed, blocks that user without affecting anyone else or the global budget.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Per-user spend ceiling, in US dollars. Once a single logged-in user's
 * accumulated cost reaches this, their further queries are rejected — but the
 * global provider budget (your real backstop) is barely touched, so the next
 * visitor (e.g. an interviewer) still gets a full-quality demo.
 *
 * Override via env without redeploying logic. Default: 10 cents.
 */
const SPEND_CAP_USD = Number(process.env.PER_USER_SPEND_CAP_USD ?? '0.10')

/** Same value expressed in micros (millionths of a dollar) for the DB. */
export const SPEND_CAP_MICROS = Math.round(SPEND_CAP_USD * 1_000_000)

// ---------------------------------------------------------------------------
// Admin client (service role) — bypasses RLS, used for verification + ledger.
// ---------------------------------------------------------------------------

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (_admin) return _admin
  _admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  return _admin
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthedUser {
  id: string
  email: string | null
}

/**
 * Verify the bearer token on a request and return the user, or null if missing
 * / invalid / expired. Routes turn null into a 401.
 *
 * `supabase.auth.getUser(token)` validates the JWT against the project's keys
 * and returns the canonical user — this is the verification step that makes the
 * id trustworthy.
 */
export async function getAuthedUser(req: Request): Promise<AuthedUser | null> {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null

  const token = header.slice(7).trim()
  if (!token) return null

  const { data, error } = await admin().auth.getUser(token)
  if (error || !data?.user) return null

  return { id: data.user.id, email: data.user.email ?? null }
}

// ---------------------------------------------------------------------------
// Spend enforcement
// ---------------------------------------------------------------------------

export interface SpendStatus {
  totalMicros: number
  overCap: boolean
  blocked: boolean
}

/**
 * Cheap pre-flight check, BEFORE calling any paid model: is this user already
 * over their cap or hard-blocked? Reading is free, so we reject over-limit users
 * without spending a cent. Fails OPEN on a DB error (returns not-over-cap) so a
 * transient Supabase blip doesn't take the demo down — the post-call recorder
 * and the provider budget are the harder backstops.
 */
export async function precheckSpend(userId: string): Promise<SpendStatus> {
  const { data, error } = await admin().rpc('check_spend', {
    p_user_id: userId,
    p_cap_micros: SPEND_CAP_MICROS,
  })
  if (error || !data || !data[0]) {
    console.error('[auth] check_spend failed (failing open):', error)
    return { totalMicros: 0, overCap: false, blocked: false }
  }
  const row = data[0]
  return {
    totalMicros: Number(row.total_micros),
    overCap: Boolean(row.over_cap),
    blocked: Boolean(row.blocked),
  }
}

/**
 * Atomically add measured cost to a user's ledger AFTER a model call, returning
 * their new status. The atomic upsert in record_spend() prevents two concurrent
 * requests from both reading a stale (under-cap) total — the lost-update bug the
 * old in-memory limiter had.
 */
export async function recordSpend(
  userId: string,
  costMicros: number
): Promise<SpendStatus> {
  const { data, error } = await admin().rpc('record_spend', {
    p_user_id: userId,
    p_cost_micros: Math.max(0, Math.round(costMicros)),
    p_cap_micros: SPEND_CAP_MICROS,
  })
  if (error || !data || !data[0]) {
    console.error('[auth] record_spend failed:', error)
    // We already spent the money; report best-effort not-blocked.
    return { totalMicros: 0, overCap: false, blocked: false }
  }
  const row = data[0]
  return {
    totalMicros: Number(row.total_micros),
    overCap: Boolean(row.over_cap),
    blocked: Boolean(row.blocked),
  }
}

export { SPEND_CAP_USD }
