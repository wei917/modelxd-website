// lib/user-face.ts — the name and photo an account shows (Sep 29, LINE).
//
// Google fills user_metadata.full_name and avatar_url; a custom OIDC provider
// such as LINE (lib/line-login.ts) fills only the standard claims, name and
// picture, and may have no email at all. Every place that draws an account
// reads it through here so a LINE user is not a blank "X".
//
// Client-safe.

type Meta = Record<string, unknown> | null | undefined
type UserLike = { email?: string | null; user_metadata?: Meta } | null | undefined

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function userName(u: UserLike): string | null {
  const m = u?.user_metadata
  // X (Oct 2) may give no email; its @username is the next best name.
  return str(m?.full_name) ?? str(m?.name) ?? str(m?.preferred_username) ?? str(m?.user_name) ?? (u?.email ? u.email.split('@')[0] : null)
}

export function userPhoto(u: UserLike): string | null {
  const m = u?.user_metadata
  const url = str(m?.avatar_url) ?? str(m?.picture)
  return url && /^https:\/\//.test(url) ? url : null
}
