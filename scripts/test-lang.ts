// scripts/test-lang.ts — the first-paint language (lib/lang.ts).
// The rule (?lang= > saved choice > site-aware browser fallback) on the
// server and in the browser, the proxy's stamp, LangProvider's mount step,
// the pre-paint migration script under stubbed cookies and storage, and the
// server titles held equal to the client's strings. No network, no server.
//   npx tsx scripts/test-lang.ts

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { NextRequest } from 'next/server'
import {
  LANG_CODES, LANG_BOOT, LANG_HEADER, isLang, savedLang, langFromTag, acceptTags, browserLang, resolveLang,
  cookieLang, serverLang, clientLangInit, langCookie, type Lang,
} from '../lib/lang'
import { STRINGS } from '../lib/i18n'
import { xtellMetadata } from '../lib/xtell-meta'
import { xcreateMetadata } from '../lib/xcreate-meta'
import { mintSiteToken } from '../lib/site-token'
import { proxy } from '../proxy'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const hdrs = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null })

// ── The rule ───────────────────────────────────────────────────────────────
check('five codes, strict; the old toggle\'s "zh" counts only as a saved choice', same(LANG_CODES, ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']) && !isLang('zh') && savedLang('zh') === 'zh-Hant' && savedLang('xx') === null && savedLang(null) === null)
check('browser tags: Hant script / TW / HK / MO are Traditional, other zh Simplified', langFromTag('zh-TW') === 'zh-Hant' && langFromTag('zh-Hant-HK') === 'zh-Hant' && langFromTag('zh-MO') === 'zh-Hant' && langFromTag('zh-CN') === 'zh-Hans' && langFromTag('zh') === 'zh-Hans' && langFromTag('ja-JP') === 'ja' && langFromTag('ko') === 'ko' && langFromTag('en-GB') === 'en' && langFromTag('fr') === null)
check('Accept-Language: most preferred first, q=0 dropped, junk ignored',
  same(acceptTags('ja,en-US;q=0.9,en;q=0.8'), ['ja', 'en-US', 'en']) && same(acceptTags('en;q=0.5, ko'), ['ko', 'en']) &&
  same(acceptTags('zh-TW;q=0, ja;q=0.3'), ['ja']) && same(acceptTags(''), []) && same(acceptTags(null), []) && same(acceptTags(' , ;q=1,fr;q=abc'), []))
const X = (...tags: string[]) => browserLang(tags, 'xtell')
check('XTell fallback: English skipped, bare zh is 繁體, only Hans/CN/SG is 简体, default 繁體',
  X('en-US') === 'zh-Hant' && X('en-US', 'ja') === 'ja' && X('zh') === 'zh-Hant' && X('zh-CN') === 'zh-Hans' && X('zh-SG') === 'zh-Hans' &&
  X('zh-Hans') === 'zh-Hans' && X('zh-HK') === 'zh-Hant' && X('ko-KR') === 'ko' && X() === 'zh-Hant' && X('fr') === 'zh-Hant')
for (const site of ['modelxd', 'xcreate'] as const) {
  const W = (...tags: string[]) => browserLang(tags, site)
  check(`${site} fallback: first supported language, English otherwise`, W('en-US', 'ja') === 'en' && W('ja') === 'ja' && W('zh') === 'zh-Hans' && W('zh-TW') === 'zh-Hant' && W('fr') === 'en' && W('fr', 'ko') === 'ko' && W() === 'en')
}
check('the reported case: 繁體 saved, Japanese browser, XTell → 繁體', resolveLang({ saved: 'zh-Hant', tags: acceptTags('ja-JP,ja;q=0.9'), site: 'xtell' }) === 'zh-Hant')
check('every saved choice beats the browser, on every door', (['modelxd', 'xtell', 'xcreate'] as const).every(site => LANG_CODES.every(l => resolveLang({ saved: l, tags: ['ja', 'ko', 'zh-CN', 'en'], site }) === l)))
check('every valid ?lang= beats the saved choice; an invalid one is ignored', LANG_CODES.every(q => resolveLang({ query: q, saved: q === 'ko' ? 'ja' : 'ko', tags: ['en'], site: 'xtell' }) === q) && resolveLang({ query: 'xx', saved: 'ja', tags: [], site: 'xtell' }) === 'ja' && resolveLang({ query: 'zh', saved: null, tags: ['ko'], site: 'modelxd' }) === 'ko')
check('an invalid saved value falls through to the browser', resolveLang({ saved: 'klingon', tags: ['ko'], site: 'modelxd' }) === 'ko' && resolveLang({ saved: 'zh', tags: ['ko'], site: 'modelxd' }) === 'zh-Hant')

// ── Server ─────────────────────────────────────────────────────────────────
check('cookie parsing', cookieLang('a=1; modelxd_lang=ja; b=2') === 'ja' && cookieLang('modelxd_lang=ko') === 'ko' && cookieLang('xmodelxd_lang=ja') === null && cookieLang('') === null && cookieLang(null) === null)
check('serverLang: the proxy\'s stamp first', serverLang(hdrs({ 'x-modelxd-lang': 'ko', cookie: 'modelxd_lang=ja', 'accept-language': 'en' }), 'modelxd') === 'ko')
check('serverLang without a stamp: cookie, then Accept-Language for the door', serverLang(hdrs({ cookie: 'modelxd_lang=ja', 'accept-language': 'ko' }), 'xtell') === 'ja' && serverLang(hdrs({ 'accept-language': 'en-US,ja;q=0.5' }), 'xtell') === 'ja' && serverLang(hdrs({ 'accept-language': 'en-US' }), 'xtell') === 'zh-Hant' && serverLang(hdrs({}), 'modelxd') === 'en')
check('serverLang ignores a bad stamp', serverLang(hdrs({ 'x-modelxd-lang': '<script>', cookie: 'modelxd_lang=ja' }), 'modelxd') === 'ja')

// ── Client mount step (LangProvider) ───────────────────────────────────────
const init = (o: Partial<Parameters<typeof clientLangInit>[0]>) => clientLangInit({ initial: 'zh-Hant', query: null, cookie: null, stored: null, ...o })
check('first visitor: keep the server\'s language, save nothing', same(init({}), { lang: 'zh-Hant', save: false, stripQuery: false }))
check('?lang= is saved like a picker choice and stripped', same(init({ query: 'ja', cookie: 'ko', stored: 'ko' }), { lang: 'ja', save: true, stripQuery: true }))
check('an invalid ?lang= stays in the URL and does nothing', same(init({ query: 'xx', cookie: 'ko', stored: 'ko' }), { lang: 'ko', save: false, stripQuery: false }))
check('a cookie is the saved choice; localStorage is brought in line', same(init({ cookie: 'ja', stored: 'ja' }), { lang: 'ja', save: false, stripQuery: false }) && same(init({ cookie: 'ja', stored: 'ko' }), { lang: 'ja', save: true, stripQuery: false }) && same(init({ cookie: 'ja' }), { lang: 'ja', save: true, stripQuery: false }))
check('a choice only in localStorage moves into the cookie (legacy "zh" too)', same(init({ stored: 'ko' }), { lang: 'ko', save: true, stripQuery: false }) && same(init({ stored: 'zh' }), { lang: 'zh-Hant', save: true, stripQuery: false }))
check('storage denied or junk: the server\'s language, nothing saved', same(init({ stored: null, cookie: null }), { lang: 'zh-Hant', save: false, stripQuery: false }) && same(init({ stored: 'xx', cookie: 'yy' }), { lang: 'zh-Hant', save: false, stripQuery: false }))
check('the cookie a choice is written as', langCookie('ja', false) === 'modelxd_lang=ja; Path=/; Max-Age=31536000; SameSite=Lax' && langCookie('ko', true).endsWith('; Secure'))

// ── The pre-paint migration script ─────────────────────────────────────────
type Boot = { search?: string; cookies?: Record<string, string>; stored?: string | null; html: Lang; https?: boolean; blocked?: boolean; flag?: boolean; storageThrows?: boolean; sessionThrows?: boolean; sessionGetterThrows?: boolean; sessionSetThrows?: boolean }
function boot(o: Boot) {
  const jar: Record<string, string> = { ...(o.cookies ?? {}) }
  const written: string[] = []
  let reloads = 0
  const session: Record<string, string> = o.flag ? { 'modelxd:lang-boot': '1' } : {}
  const document = {
    documentElement: { lang: o.html },
    get cookie() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') },
    set cookie(v: string) { written.push(v); if (o.blocked) return; const [pair] = v.split(';'); const i = pair.indexOf('='); jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim() },
  }
  const localStorage = { getItem: (k: string) => { if (o.storageThrows) throw new Error('SecurityError'); return k === 'modelxd:lang' ? o.stored ?? null : null } }
  const sessionStorage = {
    getItem: (k: string) => { if (o.sessionThrows) throw new Error('SecurityError'); return session[k] ?? null },
    setItem: (k: string, v: string) => { if (o.sessionThrows || o.sessionSetThrows) throw new Error('QuotaExceededError'); session[k] = v },
  }
  const location = { search: o.search ?? '', protocol: o.https ? 'https:' : 'http:', reload: () => { reloads++ } }
  const ctx: Record<string, unknown> = { document, localStorage, location, decodeURIComponent }
  // Some browsers throw on merely reading the sessionStorage global.
  Object.defineProperty(ctx, 'sessionStorage', { get: () => { if (o.sessionGetterThrows) throw new Error('SecurityError'); return sessionStorage } })
  vm.runInNewContext(LANG_BOOT, ctx)
  return { reloads, jar, written, session }
}
{
  const a = boot({ stored: 'zh-Hant', html: 'ja' })
  check('legacy 繁體 on a page rendered in Japanese: cookie written, one reload', a.jar.modelxd_lang === 'zh-Hant' && a.reloads === 1 && a.session['modelxd:lang-boot'] === '1' && /Max-Age=31536000; SameSite=Lax$/.test(a.written[0]))
  const again = boot({ stored: 'zh-Hant', html: 'ja', flag: true })
  check('never a second reload in the same tab session', again.reloads === 0 && again.jar.modelxd_lang === 'zh-Hant')
  check('legacy choice equal to the rendered language: cookie only, no reload', (() => { const r = boot({ stored: 'ja', html: 'ja' }); return r.jar.modelxd_lang === 'ja' && r.reloads === 0 })())
  check('a valid cookie means the server already knew: nothing happens', (() => { const r = boot({ cookies: { modelxd_lang: 'zh-Hant' }, stored: 'ja', html: 'zh-Hant' }); return r.written.length === 0 && r.reloads === 0 })())
  check('an invalid cookie is replaced by the stored choice', (() => { const r = boot({ cookies: { modelxd_lang: 'xx' }, stored: 'ko', html: 'en' }); return r.jar.modelxd_lang === 'ko' && r.reloads === 1 })())
  check('a valid ?lang= outranks storage: nothing happens', (() => { const r = boot({ search: '?lang=ko', stored: 'ja', html: 'ko' }); return r.written.length === 0 && r.reloads === 0 })())
  check('an invalid ?lang= does not stop the migration', (() => { const r = boot({ search: '?x=1&lang=xx', stored: 'ja', html: 'en' }); return r.jar.modelxd_lang === 'ja' && r.reloads === 1 })())
  check('cookies blocked: the write does not stick, so no reload (no loop)', (() => { const r = boot({ stored: 'zh-Hant', html: 'ja', blocked: true }); return r.written.length === 1 && r.reloads === 0 })())
  check('localStorage denied: nothing, no error', (() => { const r = boot({ stored: 'ja', html: 'en', storageThrows: true }); return r.written.length === 0 && r.reloads === 0 })())
  check('sessionStorage denied (getItem/setItem throw): cookie written AND the corrective reload happens', (() => { const r = boot({ stored: 'ja', html: 'en', sessionThrows: true }); return r.jar.modelxd_lang === 'ja' && r.reloads === 1 })())
  check('sessionStorage denied (the global itself throws): cookie written, one reload', (() => { const r = boot({ stored: 'ko', html: 'zh-Hant', sessionGetterThrows: true }); return r.jar.modelxd_lang === 'ko' && r.reloads === 1 })())
  check('sessionStorage full (setItem throws): still one reload', (() => { const r = boot({ stored: 'ja', html: 'en', sessionSetThrows: true }); return r.jar.modelxd_lang === 'ja' && r.reloads === 1 })())
  check('no loop without sessionStorage: after the reload the cookie is there and nothing happens', (() => { const r = boot({ cookies: { modelxd_lang: 'ja' }, stored: 'ja', html: 'ja', sessionThrows: true }); return r.written.length === 0 && r.reloads === 0 })())
  check('the old toggle\'s "zh" migrates as 繁體; https cookies are Secure', (() => { const r = boot({ stored: 'zh', html: 'zh-Hant', https: true }); return r.jar.modelxd_lang === 'zh-Hant' && r.reloads === 0 && r.written[0].endsWith('; Secure') })())
  check('nothing saved anywhere: nothing happens', (() => { const r = boot({ stored: null, html: 'zh-Hant' }); return r.written.length === 0 && r.reloads === 0 })())
}

// ── Titles: the server's first paint is the client's title ─────────────────
check('XTell titles and descriptions exist in all five languages and equal xtell.site.tab', LANG_CODES.every(l => xtellMetadata(l).title === (STRINGS['xtell.site.tab'] as any)[l] && typeof xtellMetadata(l).description === 'string' && (xtellMetadata(l).description as string).length > 20))
check('XCreate: the wordmark, and xcreate.subtitle as the description, in all five', LANG_CODES.every(l => xcreateMetadata(l).title === 'XCreate' && xcreateMetadata(l).description === (STRINGS['xcreate.subtitle'] as any)[l]))

// ── The pieces that must stay wired ────────────────────────────────────────
{
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const layout = read('app/layout.tsx')
  check('layout: <html lang> and LangProvider start from the server\'s language', /<html lang=\{lang\}/.test(layout) && /<LangProvider initial=\{lang\}>/.test(layout) && /serverLang\(h, site\)/.test(layout))
  check('layout: the migration script is the first child of <head> (the first inline script once rendered)', /<head>\s*\{\/\*[\s\S]*?\*\/\}\s*<script dangerouslySetInnerHTML=\{\{ __html: LANG_BOOT \}\} \/>/.test(layout))
  check('metadata in <head> for every visitor', /htmlLimitedBots:\s*\/\.\*\//.test(read('next.config.js')))
  check('no timed re-titling left in the door top bars', !/setTimeout\(apply/.test(read('app/components/xtell/XTellNav.tsx')) && !/setTimeout\(apply/.test(read('app/components/xcreate/XCreateNav.tsx')))
  check('every generateMetadata takes the resolved language', ['app/layout.tsx', 'app/page.tsx', 'app/xtell/page.tsx', 'app/xcreate/page.tsx'].every(f => !/(xtell|xcreate)Metadata\(h\)/.test(read(f))))
}

// ── The proxy stamps it ────────────────────────────────────────────────────
async function proxyChecks() {
  const stamp = async (url: string, headers: Record<string, string> = {}) => {
    // A real server always sends Host (with the port, which picks the door
    // locally); a NextRequest built here has none unless given one.
    const res = await proxy(new NextRequest(url, { headers: { host: new URL(url).host, ...headers } }))
    return { lang: res.headers.get(`x-middleware-request-${LANG_HEADER}`), site: res.headers.get('x-middleware-request-x-modelxd-site'), status: res.status }
  }
  const x = 'http://localhost:3001/'
  check('proxy: ?lang= first', (await stamp(x + '?lang=ja', { cookie: 'modelxd_lang=zh-Hans', 'accept-language': 'ko' })).lang === 'ja')
  check('proxy: then the saved cookie (the reported case)', (await stamp(x, { cookie: 'modelxd_lang=zh-Hant', 'accept-language': 'ja-JP,ja;q=0.9' })).lang === 'zh-Hant')
  check('proxy: then the browser, XTell-aware', (await stamp(x, { 'accept-language': 'en-US,en;q=0.9' })).lang === 'zh-Hant' && (await stamp(x, { 'accept-language': 'ko-KR' })).lang === 'ko')
  check('proxy: the door is read from the host', (await stamp(x)).site === 'xtell' && (await stamp('http://localhost:3030/')).site === 'xcreate' && (await stamp('http://localhost:3000/')).site === 'modelxd')
  check('proxy: www and XCreate fall back to their own rule', (await stamp('http://localhost:3000/', { 'accept-language': 'en-US' })).lang === 'en' && (await stamp('http://localhost:3030/', { 'accept-language': 'en-US,ja;q=0.5' })).lang === 'en' && (await stamp('http://localhost:3030/', { 'accept-language': 'fr,ja;q=0.5' })).lang === 'ja')
  check('proxy: a client-sent language header is replaced', (await stamp(x, { 'x-modelxd-lang': 'en', 'accept-language': 'ko' })).lang === 'ko')
  const prevPw = process.env.SITE_PASSWORD
  process.env.SITE_PASSWORD = 'test-secret'
  try {
    const token = await mintSiteToken('test-secret', 3600)
    const gated = await stamp('https://www.modelxd.com/xboard', { cookie: `modelxd_site_unlocked=${token}; modelxd_lang=ja` })
    check('proxy: past the www password gate the language is still stamped', gated.lang === 'ja' && gated.status === 200)
    const locked = await stamp('https://www.modelxd.com/xboard', { cookie: 'modelxd_lang=ja' })
    check('proxy: without the password it still redirects to /coming-soon', locked.status === 307 || locked.status === 308)
  } finally { if (prevPw === undefined) delete process.env.SITE_PASSWORD; else process.env.SITE_PASSWORD = prevPw }
}

proxyChecks().catch(e => { fails++; console.log('FAIL threw', e?.stack ?? e) }).then(() => {
  console.log(fails ? `\n${fails} FAILED` : '\nall language checks passed')
  if (fails) process.exit(1)
})
