import { NextRequest, NextResponse } from 'next/server'
import { getAuthedUser, precheckSpend, SPEND_CAP_USD, SPEND_CAP_MICROS } from '@/lib/auth'
import { microsToUsdString } from '@/lib/cost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Lightweight read of the signed-in user's spend, for a UI budget indicator. */
export async function GET(req: NextRequest) {
  const user = await getAuthedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  }

  const status = await precheckSpend(user.id)
  return NextResponse.json(
    {
      spent: microsToUsdString(status.totalMicros),
      capUsd: SPEND_CAP_USD,
      remainingMicros: Math.max(0, SPEND_CAP_MICROS - status.totalMicros),
      overCap: status.overCap,
      blocked: status.blocked,
      email: user.email,
      // TEMPORARY DEBUG — remove after diagnosis. Exposes exactly which user id
      // the route resolved the token to, and the raw micros the ledger returned
      // for that id. If _debug_userId here differs from the id whose row shows
      // 59391 in SQL, the auth layer is resolving a different identity.
      _debug_userId: user.id,
      _debug_totalMicros: status.totalMicros,
    },
    // This value changes after every question, so it must never be cached —
    // by the browser, by Next's data cache, or by any CDN layer in front.
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}
