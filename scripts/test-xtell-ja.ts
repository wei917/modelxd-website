// scripts/test-xtell-ja.ts — the Japanese XTell copy reads as Japanese
// (a Japanese tester, Sep 29: 筊, 廟, 籤詩 and 老師 were Chinese carried
// into Japanese; 八字, 月老 and 九曜 needed familiar names; the footer said
// every reading was of a 命盤). Run: npx tsx scripts/test-xtell-ja.ts
import fs from 'node:fs'
import path from 'node:path'
import { STRINGS } from '../lib/i18n'
import { XTELL_TEMPLE_NAMES } from '../lib/xtell-meta'

let fails = 0
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const S = STRINGS as any
const ja = Object.entries(S).filter(([k, v]: [string, any]) => (k.startsWith('xtell') || k.startsWith('legal')) && typeof v?.ja === 'string').map(([k, v]: [string, any]) => [k, v.ja as string] as const)
const bad = (rx: RegExp) => ja.filter(([, v]) => rx.test(v)).map(([k]) => k)

check('no 称骨 suggestion on Japanese pages: it means nothing there (second reviewer, Sep 29)', !S['xtell.as.chip.3'].ja.includes('称骨') && !S['xtell.q.bazi.4'].ja.includes('称骨') && !S['xtell.as.chip.3'].ja.includes('何両何銭'))
check('no 老師 in Japanese: the teachers are 先生', bad(/老師/).length === 0, bad(/老師/).join(' '))
check('no 籤詩, 廟街, 入廟, 解籤, 還願 or 守願人 in Japanese', bad(/籤詩|廟街|入廟|解籤|還願|守願/).length === 0, bad(/籤詩|廟街|入廟|解籤|還願|守願/).join(' '))
// 筊 only as a gloss after ポエ, or as a named result (聖筊 / 笑筊 / 陰筊) the rule has explained.
const bareJiao = ja.filter(([, v]) => v.replace(/ポエ（筊[^）]*）|[聖笑陰]筊/g, '').includes('筊')).map(([k]) => k)
check('筊 never stands alone in Japanese: ポエ（筊）', bareJiao.length === 0, bareJiao.join(' '))
check('命盤 in Japanese only for 紫微斗数', bad(/命盤/).every(k => k.includes('ziwei')), bad(/命盤/).join(' '))
check('familiar Japanese names', S['xtell.site.focus.bazi.name'].ja === '四柱推命（八字）' && S['xtell.site.focus.yuelao.name'].ja === '縁結び（月老）' && S['xtell.site.focus.navagraha.name'].ja.startsWith('インド占星術'))
check('九曜 says it is not 九星気学', S['xtell.site.focus.navagraha.description'].ja.includes('九星気学とは別'))
check('媽祖, 関帝, 四面仏 and 月老 say who they are, in ja, ko and en', ['mazu', 'guandi', 'simianfo', 'yuelao'].every(t => ['ja', 'ko', 'en'].every(l => {
  const d = S[`xtell.site.focus.${t}.description`][l] as string
  return /海の女神|sea goddess|바다의 여신|関羽|Guan Yu|관우|ブラフマー|Brahma|브라흐마|赤い糸|red thread|붉은 실/.test(d)
})))
check('the footer and disclaimer no longer say every reading is of a chart', ['xtell.site.footerNote', 'xtell.disclaimer'].every(k => ['ja', 'ko', 'en'].every(l => /カード|card|카드/.test(S[k][l]))))
check('the omikuji edition has its own line, in five languages, and it claims no throw', ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].every(l => S['xtell.qian.random.omikuji']?.[l]?.trim() && !/筊|ポエ|throw|교배|성배/.test(S['xtell.qian.random.omikuji'][l])))
const client = fs.readFileSync(path.join(__dirname, '..', 'app/xtell/client.tsx'), 'utf8')
check('the ritual panel uses it when no 筊 is thrown', client.includes("t(jiao ? 'xtell.qian.random' : 'xtell.qian.random.omikuji')"))
check('link previews carry the same names', Object.entries(XTELL_TEMPLE_NAMES).every(([t, n]) => ['ja', 'ko'].every(l => (n as any)[l] === S[`xtell.site.focus.${t}.name`][l])))

// Japanese answers (item 6): the prompt says Japanese only, restates it
// after the Chinese facts, and the route logs any Chinese prose it sees.
const route = fs.readFileSync(path.join(__dirname, '..', 'app/api/xtell/reading/route.ts'), 'utf8')
check('the Japanese answer line forbids Chinese sentences and asks a translation of quoted verse', /'ja': '回答言語：日本語のみ。[^']*中国語の文[^']*日本語訳/.test(route))
check('the language is restated after the Chinese facts, and the switch clause is in Japanese', route.includes('（最終確認：上の資料は中国語ですが、回答はすべて日本語で書くこと') && /\$\{facts\}\$\{classicsBlock\(temple, classicsQuery\)\}\$\{closingLine\(body\?\.lang\)\}/.test(route) && route.includes("'ja': '相談者が日本語以外の言語で書いた場合だけ"))
const { chineseLeak, leaksChinese } = require('../lib/xtell-lang-check')
check('leak check: Chinese prose in Japanese is caught', leaksChinese('今日は良い日です。但是你还有很多问题，现在应该给自己时间。'))
check('leak check: plain Japanese with shared kanji is not', !leaksChinese('今日は会社で学ぶことが多く、気持ちが現れる日です。問題は里帰りのあとに見えてきます。'))
check('leak check: a quoted 繁體 verse with its Japanese translation is not', !leaksChinese('籤の詩：「開花結子一半枯，可惜今年汝虛度。」（花は咲いたが実は半ば枯れる。今年を無駄にしないように。）發願の心で。') && chineseLeak('这们').count === 2)
// Payment trust in Japan (item 7): yen beside USD, the refund terms in view.
const { yenApprox, JPY_PER_USD } = require('../lib/plans')
const { fmtUsdFor } = require('../lib/xtell-presets')
check('yen at the plan\'s own rate (¥749 for $4.99)', Math.abs(JPY_PER_USD - 150.1) < 0.1 && yenApprox(0.01) === '約1.5円' && yenApprox(10) === '約1,501円' && yenApprox(0.0005) === '0.1円未満' && yenApprox(0.0047) === '約0.7円')
check('estimates show yen on Japanese pages only', fmtUsdFor(0.0011, 'ja') === '$0.0011（約0.2円）' && fmtUsdFor(0.0011, 'en') === '$0.0011')
check('the cookie\'s cent says its yen in Japanese', ['xtell.cookie.price', 'xtell.cookie.charged', 'xtell.err.no_credits', 'xtell.site.focus.howCookie'].every(k => S[k].ja.includes('1セント（約1.5円）')))
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']
check('the plan card says there are no part-month refunds, in five languages', LANGS.every(l => /refund|退款|返金|환불/.test(S['profile.plan.fine'][l])))
const topup = Object.keys(S).filter(k => k.startsWith('profile.topup.'))
check(`the top-up dialog in five languages (${topup.length} strings), with its refund rule`, topup.length >= 16 && topup.every(k => LANGS.every(l => S[k][l]?.trim())) && LANGS.every(l => /refund|退款|返金|환불/.test(S['profile.topup.fine'][l])))
const profile = fs.readFileSync(path.join(__dirname, '..', 'app/profile/page.tsx'), 'utf8')
check('no English left hard-coded in the top-up dialog', !/>\s*(Add credits|Top up · USD|Redirecting to Stripe|Secure payment via Stripe[^<]*)\s*</.test(profile) && !profile.includes("'Redirecting…'") && !profile.includes('`Pay ${amount} →`'))
// 特定商取引法に基づく表記 (Sep 29): served on every door, linked from every
// footer, the seller named as the LLC and the owner never.
const toku = fs.readFileSync(path.join(__dirname, '..', 'app/tokushoho/page.tsx'), 'utf8')
const site = fs.readFileSync(path.join(__dirname, '..', 'lib/site.ts'), 'utf8')
check('the 特商法 page names ModelXD LLC, its address and support@modelxd.com', toku.includes("['販売業者', 'ModelXD LLC']") && toku.includes('Casper, Wyoming 82609') && toku.includes('mailto:support@modelxd.com'))
check('the responsible person and phone are disclosed on request', toku.includes("['運営統括責任者', ON_REQUEST]") && toku.includes("['電話番号', ON_REQUEST]") && toku.includes('請求があった場合には、遅滞なく電子メールにて開示いたします。'))
check('it states prices, payment timing, delivery and the refund rules', ['販売価格', '支払方法', '支払時期', '引渡時期', '返品・キャンセル', '日割りの返金はありません'].every(w => toku.includes(w)))
check('served on the XTell and XCreate doors', /XTELL_ROUTES = \[[^\]]*'\/tokushoho'/.test(site) && /XCREATE_ROUTES = \[[^\]]*'\/tokushoho'/.test(site))
check('linked from the www, XTell and XCreate footers', ['app/components/Nav.tsx', 'app/components/xtell/XTellNav.tsx', 'app/components/xcreate/XCreateNav.tsx'].every(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').includes('href="/tokushoho"')))
check('the link label in five languages', LANGS.every(l => S['nav.tokushoho']?.[l]?.trim()) && S['nav.tokushoho'].ja === '特定商取引法に基づく表記')
// ── The signed-in test round of Sep 29 (all 18 rooms in 日本語) ────────────
{
  const { inLanguage } = require('../lib/xtell-lang-check')
  const zh = '今日行運月亮位於金牛座，且多項行星處於逆行狀態。與本命盤的緊密相位顯示能量正在重新調整。'
  const jp = '今日は月が牡牛座にあり、いくつかの惑星が逆行しています。出生図との相から、力の入れ方を見直す日です。'
  check('a 繁體 reading is not a Japanese one; a Japanese one is', !inLanguage(zh, 'ja') && inLanguage(jp, 'ja') && inLanguage(zh, 'zh-Hant') && !inLanguage(jp, 'zh-Hant'))
  check('…nor a Korean or English one', !inLanguage(zh, 'ko') && !inLanguage(zh, 'en') && inLanguage('Today the Moon is in Taurus and several planets are retrograde.', 'en') && inLanguage('오늘은 달이 황소자리에 있고 여러 행성이 역행합니다. 힘을 쓰는 방식을 돌아보는 날입니다.', 'ko'))
  const daily = require('../lib/xtell-daily')
  check('the daily brief tells a Japanese page to translate, not to keep Chinese terms', /Japanese \(日本語\) only/.test(daily.dailyBrief('western', 'ja')) && !/Keep Chinese technical terms/.test(daily.dailyBrief('western', 'ja')) && daily.DAILY_RULES.western === 'western-2')
  check('the daily route refuses a reading that is not in the page language', read('app/api/xtell/daily/route.ts').includes('inLanguage('))
  check('the almanac card no longer says 農民暦 or 黄暦', !/農民暦|黄暦/.test(S['xtell.today.almanacSub'].ja + S['xtell.today.almanac'].ja))
  const places = require('../lib/xtell-places')
  check('no city is chosen for the visitor; Japan first on Japanese pages, names in Japanese', !('defaultPlaceFor' in places) && !('DEFAULT_PLACE' in places) && places.placesFor('ja')[0].tz === 'Asia/Tokyo' && places.placeLabel(places.placeOf('seoul'), 'ja') === 'ソウル' && places.placeLabel(places.placeOf('naha'), 'ja').includes('那覇') && places.placeLabel(places.placeOf('taipei'), 'zh-Hant') === '台北')
  // The birthplace (owner, Oct 1): the visitor's country by IP first, then
  // the page's language; typed and picked, in any of our languages.
  check('the visitor\'s country (by IP) leads the list, whatever the page language', places.placesFor('zh-Hant', 'JP')[0].tz === 'Asia/Tokyo' && places.placesFor('ja', 'TW')[0].tz === 'Asia/Taipei' && places.placesFor('en', 'US')[0].tz.startsWith('America/') && places.placesFor('zh-Hant', null)[0].tz === 'Asia/Taipei' && places.placesFor('en', 'ZZ')[0].key === places.PLACES[0].key)
  const find = (q: string, lang: string, c?: string) => places.searchPlaces(q, lang, c).map((p: any) => p.key)
  check('a city is found by any of its names', find('大阪', 'ja')[0] === 'osaka' && find('osaka', 'en')[0] === 'osaka' && find('오사카', 'ko')[0] === 'osaka' && find('广州', 'zh-Hans')[0] === 'guangzhou' && find('廣州', 'zh-Hant')[0] === 'guangzhou' && find('ニューヨーク', 'ja')[0] === 'newyork' && find('nyc', 'en')[0] === 'newyork' && find('悉尼', 'zh-Hans')[0] === 'sydney' && find('臺北', 'zh-Hant')[0] === 'taipei' && find('さっぽろ', 'ja')[0] === 'sapporo' && find('とう', 'ja', 'JP')[0] === 'tokyo' && find('そうる', 'ja')[0] === 'seoul' && find('にゅーよーく', 'ja')[0] === 'newyork')
  check('names that start with what was typed come first, the visitor\'s country first among them', find('to', 'en', 'JP')[0] === 'tokyo' && find('to', 'en', 'CA')[0] === 'toronto' && find('', 'ja').length === 0 && find('atlantis', 'en').length === 0)
  {
    const client = read('app/xtell/client.tsx')
    check('the room starts with no birthplace and refuses one until it is picked', client.includes("useState<string>(typeof init.place === 'string' ? init.place : '')") && client.includes("useState<string>(typeof init.place2 === 'string' ? init.place2 : '')") && client.includes("(temple === 'navagraha' || temple === 'zhanxing') && !placeOf(subj?.place)) return 'place_invalid'") && client.includes("!placeOf(subj?.place2)) return 'place2_invalid'"))
    check('the birthplace is typed and picked, no dropdown of every city; the pages pass the visitor\'s country', (client.match(/<PlacePicker /g) ?? []).length === 4 && !client.includes('function PlaceRow') && read('app/xtell/page.tsx').includes("country={h.get('x-vercel-ip-country')}") && read('app/page.tsx').includes("country={h.get('x-vercel-ip-country')}"))
    check('the picker\'s words in five languages', ['xtell.place.search', 'xtell.place.change', 'xtell.place.nearby', 'xtell.place.matches', 'xtell.place.none'].every(k => ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].every(l => typeof S[k]?.[l] === 'string' && S[k][l].trim())))
  }
  check('every place has a name in ja, ko and en; twenty Japanese cities', places.PLACES.every((p: any) => ['ja', 'ko', 'en'].every(l => places.placeLabel(p, l) && (l !== 'en' || /^[A-Za-z ().]+$/.test(places.placeLabel(p, l))))) && places.PLACES.filter((p: any) => p.tz === 'Asia/Tokyo').length === 20)
  const names = require('../lib/names')
  check('a new-form kanji shows its old form and strokes; the count stays the written form\'s', names.charInfo('続').strokes === 13 && names.charInfo('続').old.ch === '續' && names.charInfo('続').old.strokes === 21 && !names.charInfo('木').old)
  check('the teacher is told both schools and not to mix the forms', names.nameFacts(names.nameChart('沢', '広'), 'male').includes('舊字體派') && names.ceziFacts(names.charInfo('続'), '').includes('不要把舊字體才有的部件'))
  const client = read('app/xtell/client.tsx')
  check('signs, planets and relation words come from the page language', client.includes("t(`xtell.sign.${i}`)") && client.includes('relText(lang, d.detail)') && client.includes('lunarLocal(lang, chart.lunar)') && !/PLANET_ZH\[[^\]]* as keyof/.test(client))
  check('the name board\'s labels are strings, the Chinese idioms on Chinese pages only', ['tian', 'ren', 'di', 'wai', 'zong'].every(k => LANGS.every(l => S[`xtell.name.ge.${k}`]?.[l])) && S['xtell.name.ge.zong'].ja === '総格' && client.includes("chinese ? g.shuli.name : ''"))
  check('no 称骨 card on Japanese pages', client.includes("chenggu && lang !== 'ja' && <ChengguCard"))
  const xt = require('../lib/xtell')
  check('every teacher is held to the chart\'s relations and verdicts, and to no gender roles', /說法不可與附上的盤或表相反/.test(xt.TONE) && /不用性別刻板印象/.test(xt.TONE))
  check('媽祖 has no grade to announce; 卦辭 and 爻辭 are kept apart', /沒有吉凶等級/.test(xt.MASTERS.mazu) && /稱爻辭，不稱卦辭/.test(xt.MASTERS.yixue))
  const rr = read('app/api/xtell/reading/route.ts')
  check('Japanese answers get the glossary (ハウス, 命式, おみくじ, no 簡体字)', rr.includes('JA_TERMS') && /ハウス/.test(rr) && /ホロスコープ/.test(rr) && /簡体字/.test(rr))
  const cat = require('../lib/xtell-catalog')
  check('the guide is given the rooms\' Japanese names', cat.roomNamesFor('ja').includes('bazi = 四柱推命') && cat.roomNamesFor('ja').includes('zhanxing = 西洋占星術') && read('app/api/xtell/assistant/route.ts').includes('roomNamesFor('))
  check('the privacy summary names LINE sign-in, in five languages', LANGS.every(l => /LINE/.test(S['legal.privacy.signin']?.[l] ?? '')) && read('app/privacy/page.tsx').includes("'legal.privacy.signin'") && /Google or LINE sign-in/.test(read('app/terms/page.tsx')))
  check('…and the situation written at 孫子兵法', /孫子/.test(S['legal.privacy.xtell'].ja) && /孫子兵法/.test(read('app/privacy/page.tsx')))
  check('the history is grouped by temple', read('app/components/xtell/XTellActivity.tsx').includes('xtell-history-group') && LANGS.every(l => S['xtell.site.historyCount']?.[l]?.includes('{n}')))
}
// ── 書き下し and translations for the temple poems (Sep 29) ────────────────
{
  const file = JSON.parse(read('content/qian/kundoku-ja.json'))
  const old = JSON.parse(read('content/names/kyujitai.json')) as Record<string, string>
  const sets = ['guandi', 'mazu', 'guanyin-gansan']
  const poems = sets.flatMap(set => (JSON.parse(read(`content/qian/${set}.json`)) as any[]).map(q => ({ id: `${set}:${q.n}`, poem: q.poem as string[] })))
  const missing = poems.filter(p => !file.items[p.id])
  check('every poem of 關帝, 媽祖 and 元三大師 観音百籤 has a Japanese reading (260)', poems.length === 260 && missing.length === 0, missing.slice(0, 5).map(p => p.id).join(' '))
  check('one 書き下し line a line of the poem, and a translation', poems.every(p => { const r = file.items[p.id]; return r && r.kundoku.length === p.poem.length && r.kundoku.every((l: string) => l.trim()) && r.modern.trim().length >= 10 }))
  // A 書き下し keeps most of its poem's kanji (in Japanese forms): a reading
  // attached to the wrong poem would share few.
  const share = (p: { id: string; poem: string[] }) => {
    const k = [...file.items[p.id].kundoku.join('')]
    const have = new Set([...k, ...k.map(c => old[c] ?? c)])
    const chars = [...p.poem.join('')]
    return chars.filter(c => have.has(c)).length / chars.length
  }
  const thin = poems.filter(p => file.items[p.id] && share(p) < 0.5)
  check('each 書き下し is of its own poem (at least half the poem\'s kanji are in it)', thin.length === 0, thin.slice(0, 5).map(p => `${p.id} ${share(p).toFixed(2)}`).join(' '))
  const kana = (t: string) => /[ぁ-ゖ]/.test(t)
  check('they are Japanese (kana in every line and translation), with no Simplified forms', poems.every(p => { const r = file.items[p.id]; return r && r.kundoku.every(kana) && kana(r.modern) }) && !/[们这说还给为么样让应关发经实问题从动种边头两见长门开间东车书习过时对气吗呢]/.test(JSON.stringify(file.items)))
  check('the file says who wrote it', /AI/.test(file.source.what) && typeof file.source.model === 'string')
  const xt = require('../lib/xtell')
  const q = xt.qianOf(20, 'guanyin', 'gansan')
  check('a stick carries its reading; the 一百籤 edition (Chinese pages) has none', q.ja?.kundoku.length === 4 && !xt.qianOf(20, 'guanyin', 'yibai').ja && xt.qianOf(26, 'guandi').ja && xt.qianOf(59, 'mazu').ja)
  check('a Japanese answer is handed the reading and told not to write its own; other languages are not', xt.guandiFacts(q, '', 'guanyin', 'gansan', 'ja').includes(q.ja.kundoku[0]) && /不要自行另作訓讀/.test(xt.guandiFacts(q, '', 'guanyin', 'gansan', 'ja')) && !xt.guandiFacts(q, '', 'guanyin', 'gansan', 'zh-Hant').includes(q.ja.kundoku[0]))
  check('the card shows both on Japanese pages, labelled as the AI\'s', read('app/xtell/client.tsx').includes("lang === 'ja' && qian.ja") && S['xtell.qian.kundoku'].ja.includes('AI') && S['xtell.qian.modern'].ja.includes('AI'))
}
// The live re-test on Sep 30 (signed in, every room in Japanese).
{
  const xt = require('../lib/xtell')
  const route = read('app/api/xtell/reading/route.ts'), client = read('app/xtell/client.tsx')
  check('every teacher is told today\'s date: 「今年」 was answered for 2024', (route.match(/\$\{todayLine\(\)\}/g) ?? []).length === 2 && /今天的日期（西元，UTC）/.test(route))
  const c = xt.baziChart({ y: 1990, m: 5, d: 15, h: 14, mi: 30, gender: 'male' })
  const next = xt.liuNianFacts(xt.liuNian(c, 1990, 2027), '明年流年')
  check('四柱推命 is given this year\'s and next year\'s 流年', next.startsWith('明年流年：2027 丁未年') && xt.liuNianFacts(xt.liuNian(c, 1990, 2026)).startsWith('今年流年：2026 丙午年') && route.includes("'明年流年'"))
  check('縁結び: each year carries the page\'s own verdict, so a hard year is not called good', /頁面上的判定：\$\{y\.good \? '順' : '有波動'\}/.test(read('lib/xtell.ts')))
  check('sign names, Jyotish periods and 四面仏 words are in the glossary', ['乙女座', '「処女座」', 'チャートルーラー', 'マハーダシャー', 'お礼参り', '願掛け', '「現代語訳」'].every(w => route.includes(w)))
  check('readings in parentheses only for a fixed list: 相刑（あいおし）, 化禄（かりく）, 危宿（ぎしゅく） were wrong', route.includes('ほかの語には読み仮名を付けない') && !route.includes('読みに確信がないときは'))
  check('the Jyotish chip says ダシャー, not 大運', S['xtell.q.navagraha.1'].ja.includes('ダシャー') && !S['xtell.q.navagraha.1'].ja.includes('大運'))
  check('a drawn stick is 第 n 番 in Japanese, as on its card', S['xtell.qian.stickunit'].ja === '番')
  check('the 太歳 note is in the page language, and 值太歲 stands alone', /ja: \{ 值太歲: '生まれ年と同じ支（値太歳）'/.test(client) && client.includes("taiSui === '值太歲' && kind === '無特殊關係' ? ts"))
  check('易: a 卦辭 is quoted whole (井 was cut before 「凶」)', read('lib/xtell.ts').includes('引卦辭或爻辭要整句照錄到句末'))
  check('an XTell charge is filed under its visit, and the history names it XTell', route.includes("referenceId: readingId ?? (model as any).id") && read('app/profile/page.tsx').includes("xtell: 'XTell',"))
}
// Chinese terms the default teacher keeps writing in Japanese answers,
// replaced by code (Sep 30).
{
  const { fixJaTerms, jaTermStream } = require('../lib/xtell-lang-check')
  const route = read('app/api/xtell/reading/route.ts')
  check('西洋占星: sign names, 月亮, 星盤, 命主星', fixJaTerms('太陽は処女座、月亮は巨蟹座、命主星は水星。星盤では摩羯座と雙魚座。', 'zhanxing') === '太陽は乙女座、月は蟹座、チャートルーラーは水星。ホロスコープでは山羊座と魚座。')
  check('correct Japanese is left alone', ['乙女座と蟹座と山羊座、月は魚座。', 'この場合相手の都合相談を。', '東北地方へ。「利西南、不利東北」。', '事業と婚姻。'].every(t => ['zhanxing', 'navagraha', 'sukuyo', 'simianfo', 'yixue', 'bazi'].every(r => fixJaTerms(t, r) === t)))
  check('インド占星: 大運 is ダシャー, a glossed pair is said once', fixJaTerms('現在の「土星の大運」は2044年まで。大運（マハダシャ）の中の副運（アンタルダシャ）。マハーダシャーとアンタルダシャー。', 'navagraha') === '現在の「土星のダシャー」は2044年まで。マハーダシャーの中のアンタルダシャー。マハーダシャーとアンタルダシャー。')
  check('…but never inside 最大運勢 or 大運勢, and only in that room', fixJaTerms('今年最大運勢の年、大運勢。', 'navagraha') === '今年最大運勢の年、大運勢。' && fixJaTerms('大運は甲申。', 'bazi') === '大運は甲申。' && fixJaTerms('大運は甲申。', 'simianfo') === '大運は甲申。')
  check('宿曜 new-form names; 四面仏 お礼参り and 願掛け; 現代語訳 everywhere', fixJaTerms('今日は參宿、明日は虛宿。', 'sukuyo') === '今日は参宿、明日は虚宿。' && fixJaTerms('還願の方法を決め、許願する。', 'simianfo') === 'お礼参りの方法を決め、願掛けする。' && fixJaTerms('白話訳：村は移っても。白話：井戸。白話小説は別。', 'yixue') === '現代語訳：村は移っても。現代語訳：井戸。白話小説は別。')
  check('replacing twice changes nothing more', ['太陽は処女座、月亮は巨蟹座。', '大運（マハダシャ）と副運。'].every(t => fixJaTerms(fixJaTerms(t, 'navagraha'), 'navagraha') === fixJaTerms(t, 'navagraha')))
  // However the provider cuts the answer into pieces, the page gets the same text.
  const long = 'あなたの太陽は処女座、月亮は巨蟹座にあります。大運（マハダシャ）は土星、副運（アンタルダシャ）も土星です。今年最大運勢の時期で、命主星は水星😀。マハダシャ'
  const whole = fixJaTerms(long, 'navagraha')
  let same = true
  for (const size of [1, 2, 3, 5, 7, 11, 16, 17, 40]) {
    const st = jaTermStream('navagraha'); let out = ''
    for (let i = 0; i < long.length; i += size) out += st.push(long.slice(i, i + size))
    out += st.end()
    if (out !== whole) same = false
  }
  check('streamed in pieces of any size, the text is the same as replaced whole', same && whole.endsWith('マハーダシャー') && whole.includes('😀'))
  const st = jaTermStream('zhanxing'); const parts = ['太陽は処', '女座です。それから長い文章が続きます、'].map(c => st.push(c))
  check('a word split across two pieces is still replaced, and nothing half-written is shown', !parts.join('').includes('処') && (parts.join('') + st.end()) === '太陽は乙女座です。それから長い文章が続きます、')
  check('the reading route streams through it on Japanese pages, and saves what it showed', route.includes("onDelta: (text) => show(fix ? fix.push(text) : text)") && route.includes('if (fix) show(fix.end())') && /body\?\.lang === 'ja' && \(!question \|\| \/\[ぁ-ゖァ-ヺ\]\/\.test\(question\)\)/.test(route))
  check('the daily reading is replaced before it is saved', read('app/api/xtell/daily/route.ts').includes("fixJaTerms(text, m === 'western' ? 'zhanxing' : 'daily')"))
}
console.log(fails ? `\n${fails} FAILED` : '\nall Japanese copy checks passed')
if (fails) process.exit(1)
