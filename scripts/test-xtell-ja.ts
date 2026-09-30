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
  check('Japanese pages start on Tokyo, Japan first, names in Japanese', places.defaultPlaceFor('ja') === 'tokyo' && places.placesFor('ja')[0].tz === 'Asia/Tokyo' && places.placeLabel(places.placeOf('seoul'), 'ja') === 'ソウル' && places.placeLabel(places.placeOf('naha'), 'ja').includes('那覇') && places.placeLabel(places.placeOf('taipei'), 'zh-Hant') === '台北')
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
console.log(fails ? `\n${fails} FAILED` : '\nall Japanese copy checks passed')
if (fails) process.exit(1)
