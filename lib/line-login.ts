// lib/line-login.ts — which LINE Login channel a visitor signs in through
// (Sep 29). LINE asks for one channel per region it serves, so Japan and
// Taiwan are separate channels under the ModelXD LLC provider, each a
// Supabase custom OIDC provider. The same person reaching the other channel
// would become a second account, so the choice is made once per browser and
// then kept: the visitor's country (Vercel's geo, on <html data-country>),
// else the page's language; a channel used before wins over both.
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
export function lineChannelFor(o: { remembered?: string | null; country?: string | null; lang?: string | null }): LineChannel | null {
  const live = (c: string | null | undefined): LineChannel | null => (c === 'jp' || c === 'tw') && LINE_CHANNELS[c].live ? c : null
  const kept = live(o.remembered)
  if (kept) return kept
  const cc = String(o.country ?? '').toUpperCase()
  if (cc === 'JP') return live('jp')
  if (cc === 'TW') return live('tw')
  if (o.lang === 'ja') return live('jp')
  if (o.lang === 'zh-Hant') return live('tw')
  return null
}

/** In the browser: the channel to offer on this page, remembering nothing yet. */
export function lineChannelHere(lang: string): LineChannel | null {
  let remembered: string | null = null
  try { remembered = localStorage.getItem(LINE_KEY) } catch { /* private mode */ }
  if (!remembered) remembered = document.cookie.match(/(?:^|;\s*)modelxd_line=(jp|tw)/)?.[1] ?? null
  return lineChannelFor({ remembered, country: document.documentElement.dataset.country ?? null, lang })
}

/** Keep the channel this browser signed in through (every modelxd.com door). */
export function rememberLineChannel(c: LineChannel): void {
  try { localStorage.setItem(LINE_KEY, c) } catch { /* private mode */ }
  const domain = /(^|\.)modelxd\.com$/.test(window.location.hostname) ? '; domain=.modelxd.com' : ''
  document.cookie = `${LINE_KEY}=${c}; path=/; max-age=${60 * 60 * 24 * 365 * 2}; SameSite=Lax${domain}`
}
