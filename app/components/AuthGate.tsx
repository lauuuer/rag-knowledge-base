'use client'

/**
 * Auth UI. Two exports:
 *   - <AuthGate>: wraps the app. Shows a sign-in screen until the user is
 *     authenticated, then renders children. Both Google and GitHub resolve to
 *     the SAME Supabase user identity model, so the per-user spend cap is shared
 *     across providers automatically — there is nothing extra to wire up.
 *   - <UserBadge>: small header element showing who's signed in + a sign-out
 *     button and an optional usage indicator.
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { getAccessToken } from '@/lib/auth-client'

function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = supabaseBrowser()
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  return { session, loading }
}

async function signInWith(provider: 'google' | 'github') {
  await supabaseBrowser().auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useSession()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
        Loading…
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center mx-auto mb-4">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">RAG Knowledge Base</h1>
          <p className="text-sm text-gray-500 mt-1 mb-6">
            Sign in to try the demo. A small per-account usage limit keeps it
            running for everyone.
          </p>

          <div className="space-y-2">
            <button
              onClick={() => signInWith('google')}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
              </svg>
              Continue with Google
            </button>

            <button
              onClick={() => signInWith('github')}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.85.09-.66.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.4 9.4 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/>
              </svg>
              Continue with GitHub
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

export function UserBadge() {
  const { session } = useSession()
  const [spent, setSpent] = useState<string | null>(null)
  const [capLabel, setCapLabel] = useState<string | null>(null)

  // Depend only on WHETHER we're logged in, not on the session object identity.
  // Supabase recreates the session object on every token refresh / tab focus,
  // and keying the effect on the object made it re-run (and re-fetch) many times
  // per minute — a refresh storm. Each in-flight fetch could resolve out of
  // order and overwrite the fresh value from the `done` event with a stale one,
  // which is what froze the number. A boolean only flips on real login/logout.
  const isAuthed = !!session

  useEffect(() => {
    if (!isAuthed) {
      setSpent(null)
      setCapLabel(null)
      return
    }

    // Monotonic guard: only the most recently *issued* request may write state.
    // Late-arriving older responses are dropped, killing the race entirely.
    let latest = 0
    let cancelled = false

    const refresh = async () => {
      const seq = ++latest
      const token = await getAccessToken()
      if (!token || cancelled) return
      try {
        const r = await fetch(`/api/usage?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!r.ok || cancelled || seq !== latest) return
        const d = await r.json()
        if (cancelled || seq !== latest) return
        setSpent(d.spent)
        setCapLabel(`$${d.capUsd.toFixed(2)}`)
      } catch {
        /* transient; keep last good value */
      }
    }

    refresh()

    // After each answered question, trust ONLY the spend total the server
    // streamed in the `done` event. It is computed AFTER record_spend commits,
    // so it is authoritative and fresh. We deliberately do NOT refetch here:
    // a follow-up /api/usage can hit a replica that hasn't caught the write yet
    // and return the pre-question value a beat later, which is exactly the
    // "jumps up then snaps back" flicker. No refetch, no race.
    const onUsage = (e: Event) => {
      const next = (e as CustomEvent).detail?.spent
      if (typeof next === 'string') {
        latest++ // invalidate any in-flight initial-load refresh
        setSpent(next)
      }
    }
    window.addEventListener('usage-updated', onUsage)
    return () => {
      cancelled = true
      window.removeEventListener('usage-updated', onUsage)
    }
  }, [isAuthed])

  if (!session) return null

  const email = session.user.email ?? 'Signed in'

  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      {spent && (
        <span className="hidden sm:inline tabular-nums">
          {spent}{capLabel ? ` / ${capLabel}` : ''}
        </span>
      )}
      <span className="hidden md:inline max-w-[160px] truncate">{email}</span>
      <button
        onClick={() => supabaseBrowser().auth.signOut()}
        className="rounded-lg border border-gray-300 px-2.5 py-1 hover:bg-gray-50 transition-colors"
      >
        Sign out
      </button>
    </div>
  )
}
