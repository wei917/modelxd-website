// lib/lang.ts — which language a page renders in, decided ONCE per request,
// by the same rule on the server and in the browser.
//
//   1. `?lang=<code>`: an explicit entry link (a QR code at an event).
//   2. The visitor's saved choice: the `modelxd_lang` cookie, which the
//      server can read; before the cookie existed the choice lived only in
//      localStorage (`modelxd:lang`), and it is still written there too.
//   3. The browser's language list, site-aware: on the XTell door English is
//      skipped and a bare "zh" means 繁體, with 繁體 as the default; elsewhere
//      the first supported language wins, English otherwise.
//
// Why here and not in LangProvider (Codex, Sep 27): the provider rendered
// English on the server and first client pass, then read localStorage on
// mount, while the tab title came from Accept-Language. A zh-Hant visitor
// with a Japanese browser saw Japanese, then Chinese. Now proxy.ts resolves
// the language, stamps it on the request (LANG_HEADER), and the root layout
// renders <html lang>, the title and the whole tree in it; the provider
// starts from the same value, so the first paint is already right and
// hydration matches.
//
// A choice saved only in localStorage (everyone who picked a language before
// the cookie) is invisible to the server once. LANG_BOOT, the first script in
// <head>, copies it into the cookie before anything paints and, if the page
// was rendered in another language, reloads once. Where cookies or storage
// are blocked it does nothing and LangProvider switches after hydration,
// which is how every visit behaved before.
//
// Pure and edge-safe: imported by proxy.ts, server components and the client.

import type { Site } from './site'

export type Lang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'
export const LANG_CODES: readonly Lang[] = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']

/** The saved choice the server can read. Host-only, like the localStorage it
 *  mirrors: each door (www, xtell., xcreate.) keeps its own choice, as before. */
export const LANG_COOKIE = 'modelxd_lang'
/** The saved choice in localStorage (the only store before the cookie). */
export const LANG_STORAGE_KEY = 'modelxd:lang'
/** Stamped on every request by proxy.ts: the language it renders in. */
export const LANG_HEADER = 'x-modelxd-lang'
const YEAR_SECONDS = 60 * 60 * 24 * 365

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANG_CODES as readonly string[]).includes(v)

/** A stored choice. The old two-language toggle stored 'zh' (Traditional). */
export const savedLang = (v: unknown): Lang | null => v === 'zh' ? 'zh-Hant' : isLang(v) ? v : null

/** A BCP-47 browser tag → a supported language, or null. Traditional and
 *  Simplified Chinese are different settings: Hant script / TW / HK / MO →
 *  zh-Hant; every other zh → zh-Hans. */
export function langFromTag(tag: string): Lang | null {
  const t = tag.toLowerCase()
  if (t.startsWith('en')) return 'en'
  if (t.startsWith('zh')) return (t.includes('hant') || t === 'zh-tw' || t === 'zh-hk' || t === 'zh-mo') ? 'zh-Hant' : 'zh-Hans'
  if (t.startsWith('ja')) return 'ja'
  if (t.startsWith('ko')) return 'ko'
  return null
}

/** An Accept-Language header as the browser's list, most preferred first
 *  (by q, ties in the order sent; q=0 means "not this one"). */
export function acceptTags(header: string | null | undefined): string[] {
  return (header ?? '').split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map(p => p.trim()).find(p => p.startsWith('q='))
      const weight = q ? Number(q.slice(2)) : 1
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, i }
    })
    .filter(x => x.tag && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .map(x => x.tag)
}

/** The browser fallback, site-aware (unchanged from LangProvider's): on the
 *  XTell door (Taiwan market, owner Sep 24) the list is consulted only for
 *  ja / ko / zh-Hans, a bare "zh" means Traditional, and anything else,
 *  an English browser included, gets 繁體. Elsewhere the first supported
 *  language wins, English otherwise. */
export function browserLang(tags: readonly string[], site: Site): Lang {
  for (const tag of tags) {
    let match = langFromTag(tag ?? '')
    if (!match) continue
    if (site === 'xtell') {
      if (match === 'en') continue
      if (match === 'zh-Hans' && !/hans|-cn|-sg/.test(tag.toLowerCase())) match = 'zh-Hant'
    }
    return match
  }
  return site === 'xtell' ? 'zh-Hant' : 'en'
}

/** The rule: explicit query > saved choice > browser fallback. */
export function resolveLang(o: { query?: string | null; saved?: string | null; tags: readonly string[]; site: Site }): Lang {
  if (isLang(o.query)) return o.query
  return savedLang(o.saved) ?? browserLang(o.tags, o.site)
}

/** The `modelxd_lang` value in a Cookie header (or document.cookie). */
export function cookieLang(cookie: string | null | undefined): string | null {
  const m = (cookie ?? '').match(/(?:^|;\s*)modelxd_lang=([^;]*)/)
  return m ? m[1].trim() : null
}

/** Server components: pass `await headers()` and the site. The proxy's stamp
 *  when present (it also saw `?lang=`); otherwise the same rule from the raw
 *  cookie and Accept-Language, so a request the proxy did not stamp still
 *  renders in the saved language. */
export function serverLang(h: { get(name: string): string | null }, site: Site): Lang {
  const stamped = h.get(LANG_HEADER)
  if (isLang(stamped)) return stamped
  return resolveLang({ saved: cookieLang(h.get('cookie')), tags: acceptTags(h.get('accept-language')), site })
}

/** The cookie a saved choice is written as (document.cookie syntax). */
export const langCookie = (l: Lang, secure: boolean): string =>
  `${LANG_COOKIE}=${l}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax${secure ? '; Secure' : ''}`

/**
 * What LangProvider does on mount, given the language the server rendered
 * (`initial`). Never a fresh browser detection: the server's fallback stands,
 * so a visitor with no saved choice is never switched after paint.
 *   - a valid `?lang=` is saved like a picker choice and dropped from the URL
 *     (Sep 14 behaviour: a reload or a shared link does not keep forcing it);
 *   - a cookie is the saved choice; localStorage is brought in line with it;
 *   - a choice only in localStorage is migrated into the cookie (and shown,
 *     if the head script could not reload with it first).
 */
export function clientLangInit(o: { initial: Lang; query: string | null; cookie: string | null; stored: string | null }): { lang: Lang; save: boolean; stripQuery: boolean } {
  if (isLang(o.query)) return { lang: o.query, save: true, stripQuery: true }
  const fromCookie = savedLang(o.cookie)
  if (fromCookie) return { lang: fromCookie, save: o.stored !== fromCookie || o.cookie !== fromCookie, stripQuery: false }
  const fromStorage = savedLang(o.stored)
  if (fromStorage) return { lang: fromStorage, save: true, stripQuery: false }
  return { lang: o.initial, save: false, stripQuery: false }
}

/**
 * Inline, first in <head>, before anything paints: a choice saved only in
 * localStorage becomes the cookie, and if the server rendered another
 * language the page reloads once so the first paint is the chosen one.
 * Does nothing when `?lang=` is valid (it outranks the saved choice), when a
 * valid cookie exists (the server already used it), or when the cookie does
 * not stick (cookies blocked). The cookie read-back is what prevents a loop:
 * after the reload the cookie exists and the script returns at once.
 * sessionStorage adds a once-per-tab guard where it is available; where it
 * is blocked the reload still happens (Codex review: the migration used to
 * stop there with the cookie written and the wrong language on screen).
 * localStorage blocked means there is nothing to migrate.
 */
export const LANG_BOOT = `(function(){try{var d=document,l=location,c=${JSON.stringify(LANG_COOKIE)},k=${JSON.stringify(LANG_STORAGE_KEY)},codes=${JSON.stringify(LANG_CODES)};` +
  `var q=(l.search.match(/[?&]lang=([^&#]*)/)||[])[1];if(q&&codes.indexOf(decodeURIComponent(q))>-1)return;` +
  `var get=function(){var m=d.cookie.match(/(?:^|;\\s*)modelxd_lang=([^;]*)/);return m?m[1]:null};if(codes.indexOf(get())>-1)return;` +
  `var s=localStorage.getItem(k);if(s==='zh')s='zh-Hant';if(codes.indexOf(s)<0)return;` +
  `d.cookie=c+'='+s+'; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax'+(l.protocol==='https:'?'; Secure':'');` +
  `if(s===d.documentElement.lang||get()!==s)return;` +
  `var g='modelxd:lang-boot';try{var ss=sessionStorage;if(ss.getItem(g))return;ss.setItem(g,'1')}catch(e){}` +
  `l.reload()}catch(e){}})();`
