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

function BrandMark({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  const dim = size === 'lg' ? 26 : 18
  return (
    <div className={`mark ${size}`}>
      <svg width={dim} height={dim} viewBox="0 0 24 24" fill="none">
        <circle cx="6" cy="6" r="2.4" fill="#0a0a12" />
        <circle cx="18" cy="9" r="2" fill="#0a0a12" />
        <circle cx="9" cy="18" r="2" fill="#0a0a12" />
        <path d="M7.6 7.4 16 8.6M7.6 16.6 9 9.4" stroke="#0a0a12" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}

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
  const [busy, setBusy] = useState<'google' | 'github' | null>(null)

  const handleSignIn = (provider: 'google' | 'github') => {
    setBusy(provider)
    signInWith(provider).catch(() => setBusy(null))
  }

  if (loading) {
    return (
      <div className="center-screen">
        <span className="spin" />
        Loading…
      </div>
    )
  }

  if (!session) {
    return (
      <div className="login-grid">
        {/* ── Left: brand hero ── */}
        <div className="hero">
          <div className="hero-top">
            <BrandMark size="sm" />
            <div className="name">RAG Knowledge Base<span>Document Q&amp;A · Cited answers</span></div>
          </div>

          <div className="hero-mid">
            <div className="eyebrow"><span className="dot" />Retrieval-Augmented Generation</div>
            <h1>Ask your documents.<br />Get answers you can <span className="grad">actually trust.</span></h1>
            <p className="lead">
              Upload a PDF or text file, ask anything in natural language, and get an answer
              streamed back — grounded in your content, with the exact source cited.
            </p>

            <div className="viz">
              <svg className="wires" viewBox="0 0 460 150" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="wireg" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="oklch(0.80 0.13 210)" />
                    <stop offset="1" stopColor="oklch(0.70 0.17 290)" />
                  </linearGradient>
                </defs>
                <path className="wire" d="M120 75 C 240 70, 280 20, 360 22" />
                <path className="wire" d="M120 75 C 250 75, 300 75, 380 75" />
                <path className="wire" d="M120 75 C 240 80, 280 128, 360 128" />
              </svg>
              <div className="q">&ldquo;What&rsquo;s our refund policy?&rdquo;</div>
              <div className="node n1">policy.pdf <span className="pct">94%</span></div>
              <div className="node n2">terms.pdf <span className="pct">88%</span></div>
              <div className="node n3">faq.txt <span className="pct">71%</span></div>
            </div>
          </div>

          <div className="hero-stats">
            <div className="stat"><div className="k">Hybrid</div><div className="l">Vector + full-text</div></div>
            <div className="hero-divider" />
            <div className="stat"><div className="k">1536<span className="u">-dim</span></div><div className="l">HNSW index</div></div>
            <div className="hero-divider" />
            <div className="stat"><div className="k">Cited</div><div className="l">Every answer</div></div>
          </div>
        </div>

        {/* ── Right: sign-in card ── */}
        <div className="signin">
          <div className="card">
            <div className="c-head">
              <BrandMark size="lg" />
              <h2>Welcome back</h2>
              <p className="sub">Sign in to upload documents and start asking questions.</p>
            </div>

            <div className="oauth">
              <button className="btn btn-google" onClick={() => handleSignIn('google')} disabled={!!busy}>
                {busy === 'google' ? (
                  <span className="spin" />
                ) : (
                  <svg className="gicon" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
                  </svg>
                )}
                <span>Continue with Google</span>
              </button>

              <button className="btn btn-github" onClick={() => handleSignIn('github')} disabled={!!busy}>
                {busy === 'github' ? (
                  <span className="spin" />
                ) : (
                  <svg className="gicon" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.85.09-.66.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.4 9.4 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
                  </svg>
                )}
                <span>Continue with GitHub</span>
              </button>
            </div>

            <div className="divider">Demo access</div>

            <div className="note">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
              </svg>
              <span>A small per-account usage limit keeps this live demo running for everyone. Both providers map to the same identity.</span>
            </div>

            <p className="legal">By continuing you agree to the <a href="#">Terms</a> &amp; <a href="#">Privacy Policy</a>.</p>
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
  const [spentNum, setSpentNum] = useState<number>(0)
  const [capUsd, setCapUsd] = useState<number | null>(null)

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
      setCapUsd(null)
      setSpentNum(0)
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
        setSpentNum(parseFloat(String(d.spent).replace(/[^0-9.]/g, '')) || 0)
        setCapUsd(d.capUsd)
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
        setSpentNum(parseFloat(next.replace(/[^0-9.]/g, '')) || 0)
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
  const initial = (email[0] || '?').toUpperCase()
  const capLabel = capUsd != null ? `$${capUsd.toFixed(2)}` : null
  const pct = capUsd && capUsd > 0 ? Math.min(100, Math.max(3, (spentNum / capUsd) * 100)) : 5

  return (
    <div className="right">
      {spent && (
        <div className="usage" title="Demo usage on this account">
          <span className="lbl">{spent}{capLabel ? ` / ${capLabel}` : ''}</span>
          <div className="meter"><i style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      <div className="user">
        <div className="avatar">{initial}</div>
        <div className="meta"><div className="nm">{email}</div></div>
      </div>
      <button className="iconbtn" title="Sign out" onClick={() => supabaseBrowser().auth.signOut()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      </button>
    </div>
  )
}
