'use client'

/**
 * REPLACES the old lib/owner.ts.
 *
 * Before: an anonymous UUID kept in localStorage was sent as `x-owner-id`. It
 * identified a browser, not a person, and was trivially forgeable or resettable.
 *
 * Now: every API call carries the logged-in user's Supabase access token in the
 * standard `Authorization: Bearer` header. The server verifies it and derives a
 * trustworthy user id. There is no client-generated id anymore.
 *
 * `authedFetch` keeps the SAME call sites working: components that imported
 * `ownedFetch` from '@/lib/owner' can import `authedFetch` from here instead and
 * change nothing else. (A re-export shim is provided at the bottom so even the
 * import path can stay the same if you prefer.)
 */

import { supabaseBrowser } from './supabase-browser'

/** Current access token, or null if the user is not signed in. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.getSession()
  return data.session?.access_token ?? null
}

/**
 * fetch() wrapper that attaches the bearer token. If there is no session it
 * still sends the request without the header; the route will answer 401 and the
 * UI will prompt for login. Throwing here instead would be fine too, but a 401
 * keeps the error handling in one place (the route).
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

// --- Back-compat shim --------------------------------------------------------
// Old code imported { ownedFetch } from '@/lib/owner'. If you'd rather not edit
// every component, you can keep lib/owner.ts re-exporting authedFetch as
// ownedFetch. See the migration steps. This alias makes that a one-liner.
export { authedFetch as ownedFetch }
