'use client'

/**
 * OAuth redirect lands here. With detectSessionInUrl enabled on the browser
 * client, the supabase-js library exchanges the code in the URL for a session
 * automatically on load. We just wait for that, then bounce home.
 *
 * Configure this exact path as a Redirect URL in the Supabase dashboard:
 *   https://YOUR-DOMAIN/auth/callback
 * (and http://localhost:3000/auth/callback for local dev).
 */

import { useEffect } from 'react'
import { supabaseBrowser } from '@/lib/supabase-browser'

export default function AuthCallback() {
  useEffect(() => {
    const supabase = supabaseBrowser()
    // Give supabase-js a tick to parse the URL and persist the session, then go.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        window.location.replace('/')
      }
    })
    // Fallback in case the event already fired before we subscribed.
    const t = setTimeout(() => window.location.replace('/'), 1500)
    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(t)
    }
  }, [])

  return (
    <div className="center-screen">
      <span className="spin" />
      Signing you in…
    </div>
  )
}
