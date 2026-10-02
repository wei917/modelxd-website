// lib/signin-tap.ts — count a tap on a sign-in button (owner, Oct 1: "add
// counter on tap google or line login"; X since Oct 2).
//
// Sent the moment Google, LINE or X is pressed, before the browser leaves, so
// a visitor who gives up on the provider's own page still counts as having
// tried. /api/visit stores it in site_signin_taps (supabase/120) under the
// visit log's rules; a sign-in that completes is in activity_logs (under the
// method it used: signInMethod below), and a failure that comes back is in
// the callback's logs.

import { LINE_CHANNELS } from './line-login'

/** The sign-in buttons. */
export type SignInVia = 'google' | 'line' | 'x'

/** The providers a tap may name, in activity_logs' words. */
export const TAP_PROVIDERS: ReadonlySet<string> = new Set(['google', 'x', ...Object.values(LINE_CHANNELS).map(c => c.provider)])

type IdentityLike = { provider: string; updated_at?: string | null }

/** The method a sign-in just used, in activity_logs' words (Oct 2). Supabase
 *  joins sign-ins with the same email into one account (Google and X, say),
 *  and app_metadata.provider keeps the FIRST method, so it misnames the other.
 *  GoTrue refreshes the identity used at every sign-in (its updated_at moves;
 *  its last_sign_in_at does not), so the most recently updated one is it.
 *  Server-safe. */
export function signInMethod(u: { app_metadata?: { provider?: string } | null; identities?: IdentityLike[] | null }): string | null {
  const at = (i: IdentityLike) => Date.parse(i.updated_at ?? '') || 0
  const used = [...(u.identities ?? [])].sort((a, b) => at(b) - at(a))[0]
  return used?.provider ?? u.app_metadata?.provider ?? null
}

export function countSigninTap(provider: string): void {
  try {
    const body = JSON.stringify({ tap: provider, path: window.location.pathname })
    // A beacon survives the redirect that follows; the same fallback as VisitTracker's.
    if (navigator.sendBeacon?.('/api/visit', body)) return
    void fetch('/api/visit', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {})
  } catch { /* counting never stands in the way of signing in */ }
}
