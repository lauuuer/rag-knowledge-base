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
  return NextResponse.json({
    spent: microsToUsdString(status.totalMicros),
    capUsd: SPEND_CAP_USD,
    remainingMicros: Math.max(0, SPEND_CAP_MICROS - status.totalMicros),
    overCap: status.overCap,
    blocked: status.blocked,
    email: user.email,
  })
}
