'use client'

/**
 * COMPATIBILITY SHIM.
 *
 * The old lib/owner.ts generated an anonymous localStorage id and exported
 * `ownedFetch` and `getOwnerId`. Components across the app import `ownedFetch`
 * from '@/lib/owner'. Rather than edit every import site, this file now simply
 * re-exports the new auth-based fetch under the old name. Existing components
 * (UploadZone, DocumentList, QueryInterface) keep working without changes — they
 * just start sending a verified bearer token instead of a forgeable header.
 *
 * The old getOwnerId() is intentionally gone: there is no client-generated id
 * anymore. If anything still imports it, that import should be removed — the
 * server derives identity from the token now.
 */

export { authedFetch as ownedFetch, getAccessToken } from './auth-client'
