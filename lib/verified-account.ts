// lib/verified-account.ts — is this a real, verified account? (Sep 29, LINE
// sign-in.) The generation routes used to ask for a confirmed email, which
// every Google account has; a LINE account has no email unless the channel
// is granted email permission, yet LINE itself verified the person. So: a
// confirmed email, OR a sign-in through an OAuth provider. Anonymous sessions
// and unconfirmed email/password accounts still fail.
//
// Client-safe.

type UserLike = { email_confirmed_at?: string | null; is_anonymous?: boolean | null; app_metadata?: { provider?: string; providers?: string[] } | null }

const NOT_OAUTH = new Set(['email', 'phone', 'anonymous'])

export function isVerifiedAccount(u: UserLike | null | undefined): boolean {
  if (!u) return false
  if (u.email_confirmed_at) return true
  if (u.is_anonymous) return false
  const providers = [...(u.app_metadata?.providers ?? []), u.app_metadata?.provider].filter((p): p is string => typeof p === 'string' && p.length > 0)
  return providers.some(p => !NOT_OAUTH.has(p))
}
