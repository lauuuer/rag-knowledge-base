'use client'

/**
 * Browser-side Supabase client (singleton). Uses the PUBLIC anon key — safe to
 * ship to the browser; it only ever acts as the logged-in user and is governed
 * by the RLS policies from the migration. Never put the service role key here.
 *
 * This client manages the OAuth session: sign-in redirects, token storage, and
 * automatic refresh. The session's access token is what the API routes verify.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function supabaseBrowser(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // completes the OAuth redirect automatically
      },
    }
  )
  return _client
}
