// lib/signin-tap.ts — count a tap on a sign-in button (owner, Oct 1: "add
// counter on tap google or line login"; X since Oct 2).
//
// Sent the moment Google, LINE or X is pressed, before the browser leaves, so
// a visitor who gives up on the provider's own page still counts as having
// tried. /api/visit stores it in site_signin_taps (supabase/120) under the
// visit log's rules; a sign-in that completes is in activity_logs, and a
// failure that comes back is in the callback's logs.

import { LINE_CHANNELS } from './line-login'

/** The sign-in buttons. */
export type SignInVia = 'google' | 'line' | 'x'

/** The providers a tap may name, in activity_logs' words. */
export const TAP_PROVIDERS: ReadonlySet<string> = new Set(['google', 'x', ...Object.values(LINE_CHANNELS).map(c => c.provider)])

export function countSigninTap(provider: string): void {
  try {
    const body = JSON.stringify({ tap: provider, path: window.location.pathname })
    // A beacon survives the redirect that follows; the same fallback as VisitTracker's.
    if (navigator.sendBeacon?.('/api/visit', body)) return
    void fetch('/api/visit', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {})
  } catch { /* counting never stands in the way of signing in */ }
}
