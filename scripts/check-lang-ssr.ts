// scripts/check-lang-ssr.ts — what a RUNNING server sends on first paint.
// For each case: <html lang>, the <title> (and that it is in <head>, not
// streamed into <body>), a visible string from the page, and that the
// language boot script is the first inline script in <head>. Read-only GETs.
//   npx tsx scripts/check-lang-ssr.ts http://localhost:3001 [xtell|xcreate|www]

import { STRINGS } from '../lib/i18n'
import { LANG_CODES, type Lang } from '../lib/lang'

const base = process.argv[2] ?? 'http://localhost:3001'
const door = (process.argv[3] ?? 'xtell') as 'xtell' | 'xcreate' | 'www'
let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const s = (k: string, l: Lang) => ((STRINGS[k] as any)[l] ?? STRINGS[k].en) as string

// A string the door's first screen renders on the server, per language.
const visible = (l: Lang) => door === 'xtell' ? s('xtell.site.focus.bazi.name', l) : door === 'xcreate' ? s('xcreate.subtitle', l) : s('nav.xduel', l)
const title = (l: Lang) => door === 'xtell' ? s('xtell.site.tab', l) : door === 'xcreate' ? 'XCreate' : 'ModelXD'

async function page(path: string, headers: Record<string, string>) {
  const res = await fetch(base + path, { headers, redirect: 'manual' })
  const html = await res.text()
  const head = html.slice(0, html.indexOf('</head>'))
  const body = html.slice(html.indexOf('</head>'))
  return {
    status: res.status,
    lang: html.match(/<html[^>]*\slang="([^"]+)"/)?.[1] ?? null,
    title: head.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/&amp;/g, '&') ?? null,
    titleInBody: /<title>/.test(body),
    // Next puts its own async chunks, styles and metadata first; what matters
    // is that the boot script is the first INLINE (blocking) script and runs
    // in <head>, before any of <body> is parsed or painted.
    bootFirst: (head.match(/<script>[^<]{0,60}/g) ?? [])[0]?.startsWith('<script>(function(){try{var d=document,l=location,c="modelxd_lang"') === true,
    html,
  }
}

const expect = async (name: string, path: string, headers: Record<string, string>, l: Lang) => {
  const p = await page(path, headers)
  const shows = p.html.includes(visible(l))
  check(`${name} → ${l}`, p.status === 200 && p.lang === l && p.title === title(l) && !p.titleInBody && shows && p.bootFirst,
    JSON.stringify({ status: p.status, lang: p.lang, title: p.title, titleInBody: p.titleInBody, shows, bootFirst: p.bootFirst }))
}

;(async () => {
  const ja = { 'accept-language': 'ja-JP,ja;q=0.9,en-US;q=0.8' }
  // The reported case, and every saved choice against a Japanese browser.
  for (const l of LANG_CODES) await expect(`saved ${l}, Japanese browser`, '/', { ...ja, cookie: `modelxd_lang=${l}` }, l)
  // First visitors: the door's browser fallback.
  if (door === 'xtell') {
    await expect('first visit, Japanese browser', '/', ja, 'ja')
    await expect('first visit, English browser (XTell skips English)', '/', { 'accept-language': 'en-US,en;q=0.9' }, 'zh-Hant')
    await expect('first visit, Korean browser', '/', { 'accept-language': 'ko-KR,ko;q=0.9' }, 'ko')
    await expect('first visit, zh-CN browser', '/', { 'accept-language': 'zh-CN,zh;q=0.9' }, 'zh-Hans')
    await expect('first visit, bare zh', '/', { 'accept-language': 'zh' }, 'zh-Hant')
    await expect('first visit, no header', '/', {}, 'zh-Hant')
  } else {
    await expect('first visit, Japanese browser', '/', ja, 'ja')
    await expect('first visit, English browser', '/', { 'accept-language': 'en-US,en;q=0.9' }, 'en')
    await expect('first visit, no header', '/', {}, 'en')
  }
  // ?lang= outranks the saved choice; an invalid one does not.
  await expect('?lang=ko over saved 繁體', '/?lang=ko', { ...ja, cookie: 'modelxd_lang=zh-Hant' }, 'ko')
  await expect('?lang=xx is ignored', '/?lang=xx', { ...ja, cookie: 'modelxd_lang=zh-Hant' }, 'zh-Hant')
  // A client-sent language header does not get through the proxy.
  await expect('a forged x-modelxd-lang header is replaced', '/', { ...ja, 'x-modelxd-lang': 'en' }, 'ja')
  console.log(fails ? `\n${fails} FAILED` : `\nall ${door} first-paint checks passed`)
  if (fails) process.exit(1)
})()
