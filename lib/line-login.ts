// lib/line-login.ts — which LINE Login channel a visitor signs in through
// (Sep 29). LINE asks for one channel per region it serves, so Japan and
// Taiwan are separate channels under the ModelXD LLC provider, each a
// Supabase custom OIDC provider. The page language picks it (日本語 → Japan,
// 繁體 → Taiwan; owner, Sep 29: language only, no geo). The same person
// reaching the other channel would become a second account, so a channel
// used before in this browser wins over the language.
//
// Client-safe.

export type LineChannel = 'jp' | 'tw'
/** Channels set up in Supabase (both live since Sep 29). */
export const LINE_CHANNELS: Record<LineChannel, { provider: string; live: boolean }> = {
  jp: { provider: 'custom:line-jp', live: true },
  tw: { provider: 'custom:line-tw', live: true },
}
export const LINE_KEY = 'modelxd_line'

/** The channel for a visitor, or null when LINE is not offered to them. */
export function lineChannelFor(o: { remembered?: string | null; lang?: string | null }): LineChannel | null {
  const live = (c: string | null | undefined): LineChannel | null => (c === 'jp' || c === 'tw') && LINE_CHANNELS[c].live ? c : null
  const kept = live(o.remembered)
  if (kept) return kept
  if (o.lang === 'ja') return live('jp')
  if (o.lang === 'zh-Hant') return live('tw')
  return null
}

/** In the browser: the channel to offer on this page. The cookie first: the
 *  server rewrites it when a sign-in lands on the other channel. */
export function lineChannelHere(lang: string): LineChannel | null {
  let remembered: string | null = document.cookie.match(/(?:^|;\s*)modelxd_line=(jp|tw)/)?.[1] ?? null
  if (!remembered) try { remembered = localStorage.getItem(LINE_KEY) } catch { /* private mode */ }
  return lineChannelFor({ remembered, lang })
}

/** Keep the channel this browser signed in through (every modelxd.com door). */
export function rememberLineChannel(c: LineChannel): void {
  try { localStorage.setItem(LINE_KEY, c) } catch { /* private mode */ }
  document.cookie = `${LINE_KEY}=${c}; ${lineCookieAttrs(window.location.hostname)}`
}

// ── One LINE person, one account (migration 113) ───────────────────────────
// Both channels are under one LINE provider, so a person has the same LINE
// id on both; the database refuses a second account for it, GoTrue reports
// "Database error saving new user", and /auth/callback restarts the sign-in
// once through the other channel, which already has the account.

/** The channel a sign-in is being attempted through, for /auth/callback. */
export const LINE_TRY = 'modelxd_line_try'
/** Set while the callback's one retry through the other channel is running. */
export const LINE_TWIN = 'modelxd_line_twin'

export const otherLineChannel = (c: LineChannel): LineChannel => (c === 'jp' ? 'tw' : 'jp')
export const asLineChannel = (v: unknown): LineChannel | null => (v === 'jp' || v === 'tw' ? v : null)
export function lineChannelOfProvider(p: unknown): LineChannel | null {
  const hit = (Object.keys(LINE_CHANNELS) as LineChannel[]).find(c => LINE_CHANNELS[c].provider === p)
  return hit ?? null
}
/** GoTrue's words when handle_new_user refuses the sign-up. */
export const isNewUserRefusal = (desc: string | null | undefined) => /saving new user/i.test(desc ?? '')

/** The remembered channel's cookie reaches every modelxd.com door. */
export const lineCookieDomain = (host: string): string | undefined => (/(^|\.)modelxd\.com$/.test(host) ? '.modelxd.com' : undefined)
export const LINE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2
/** Cookie attributes for the remembered channel: two years, every door. */
export function lineCookieAttrs(host: string): string {
  const domain = lineCookieDomain(host)
  return `path=/; max-age=${LINE_COOKIE_MAX_AGE}; SameSite=Lax${domain ? `; domain=${domain}` : ''}`
}

/** Before a sign-in: which LINE channel it goes through, or none (Google). */
export function markLineTry(c: LineChannel | null): void {
  document.cookie = c ? `${LINE_TRY}=${c}; path=/; max-age=600; SameSite=Lax` : `${LINE_TRY}=; path=/; max-age=0`
}
