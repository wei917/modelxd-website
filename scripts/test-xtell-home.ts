// scripts/test-xtell-home.ts — the XTell homepage (Oct 3, the owner's approved
// Concept 24): the turning entrance, the top bar's preview mark, today's
// cards, pinned temples in the top bar and the steps. Pure logic, plus the source
// checks that guard the promises (turning never navigates; nothing is
// never testimonials; nothing pre-filled). No network, no browser.
//   npx tsx scripts/test-xtell-home.ts

import fs from 'node:fs'
import path from 'node:path'
import { heroTemples, stepSlide, mayRotate, HERO_ART, HERO_SLIDES, HERO_FEATURED } from '../lib/xtell-hero'
import { parsePins, loadPins, savePins, pinTemple, unpinTemple, pinnedFirst, PINS_KEY } from '../lib/xtell-pins'
import { displayTemples, type TempleKey } from '../app/components/xtell/TempleArtwork'
import { STRINGS } from '../lib/i18n'
import { isXTellPath, doorHome, templeHref, XTELL_PATH } from '../lib/site'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const KNOWN = ['bazi', 'ziwei', 'yuelao', 'guandi', 'mazu', 'simianfo', 'navagraha', 'zhanxing', 'xingming', 'cezi', 'yixue', 'jiemeng', 'guanyin', 'tarot', 'cookie', 'kyusei', 'sukuyo', 'sunzi']

// ── The entrance ───────────────────────────────────────────────────────────
for (const lang of ['zh-Hant', 'zh-Hans', 'ja', 'ko', 'en']) {
  const list = heroTemples(lang)
  const chosen = HERO_FEATURED[lang]
  const expected = chosen ? displayTemples(lang).filter(k => chosen.includes(k) && !!HERO_ART[k]) : displayTemples(lang).filter(k => !!HERO_ART[k]).slice(0, HERO_SLIDES)
  check(`hero (${lang}): ${chosen ? 'its hand-picked temples' : 'the first six with art'}, in that market's own order`, list.length >= 6 && list.join() === expected.join())
}
check('in every market the top bar starts with the rotation, in the same order (owner, Oct 3)', ['zh-Hant', 'zh-Hans', 'ja', 'ko', 'en'].every(l => heroTemples(l).join() === displayTemples(l).slice(0, heroTemples(l).length).join()),
  ['zh-Hant', 'zh-Hans', 'ja', 'ko', 'en'].filter(l => heroTemples(l).join() !== displayTemples(l).slice(0, heroTemples(l).length).join()).join())
check('Chinese features 易經, 孫子兵法 and 周公解夢, never the Indian 九曜 or the Japanese 九星 (owner, Oct 3)',
  ['zh-Hant', 'zh-Hans'].every(l => ['yixue', 'sunzi', 'jiemeng'].every(k => heroTemples(l).includes(k as TempleKey)) && !heroTemples(l).includes('navagraha') && !heroTemples(l).includes('kyusei')))
check('hero art is an inventory apart from the featured six: more art never adds a dot', Object.keys(HERO_ART).length > HERO_SLIDES
  && heroTemples('ja', { ...HERO_ART, sukuyo: { wash: ['#fff', '#eee'] } }).length === 6)
const { bazi: _bazi, ...noBazi } = HERO_ART
check('a featured temple without art is skipped and the next with art steps in', heroTemples('ja', noBazi).join() === displayTemples('ja').filter(k => k !== 'bazi' && !!HERO_ART[k]).slice(0, 6).join())
const heroFiles = Object.values(HERO_ART).flatMap(a => [a!.src, a!.srcMobile, a!.srcPortrait]).filter(Boolean) as string[]
const missingArt = heroFiles.filter(f => !fs.existsSync(path.join(__dirname, '..', 'public', f)))
const heavyArt = heroFiles.filter(f => !missingArt.includes(f) && fs.statSync(path.join(__dirname, '..', 'public', f)).size > 260_000)
check(`every hero picture is on disk, wide, narrow and portrait (${heroFiles.length} files), none over 260 KB`, missingArt.length === 0 && heavyArt.length === 0, [...missingArt, ...heavyArt].join(', '))
const featured = [...new Set(['zh-Hant', 'zh-Hans', 'ja', 'ko', 'en'].flatMap(l => heroTemples(l)))]
check(`every featured temple (${featured.length}) has its portrait composition for phones`, featured.every(k => !!HERO_ART[k]?.srcPortrait), featured.filter(k => !HERO_ART[k]?.srcPortrait).join(', '))
check('slides wrap both ways', stepSlide(5, 1, 6) === 0 && stepSlide(0, -1, 6) === 5 && stepSlide(2, 0, 6) === 2 && stepSlide(0, 1, 0) === 0)
const still = { paused: false, hovered: false, focused: false, hidden: false, reducedMotion: false, count: 6 }
check('turns by itself only when nothing holds it', mayRotate(still))
check('held by: a person\'s choice, the pointer, keyboard focus, a hidden tab, less motion, a single slide',
  !mayRotate({ ...still, paused: true }) && !mayRotate({ ...still, hovered: true }) && !mayRotate({ ...still, focused: true })
  && !mayRotate({ ...still, hidden: true }) && !mayRotate({ ...still, reducedMotion: true }) && !mayRotate({ ...still, count: 1 }))

const hero = read('app/components/xtell/XTellHero.tsx')
check('turning never navigates, routes, fetches or writes the address', !/location\.hash|history\.|useRouter|router\.|fetch\(|replaceState|pushState/.test(hero))
check('the timer only moves the slide', /setTimeout\(\(\) => setIndex\(i => stepSlide\(i, 1, count\)\), HERO_SECONDS \* 1000\)/.test(hero))
check('entering is a real link into the temple (/xtell#… on www)', /<a className="xtell-hero-enter" href=\{templeHref\(base, current\)\}>/.test(hero))
check('any slide choice pauses; play is a toggle; reduced motion holds from the start until play', /const choose = \(i: number\) => \{ setIndex\(stepSlide\(i, 0, count\)\); setPaused\(true\) \}/.test(hero) && /reducedMotion: reducedMotion && !played/.test(hero))
check('hover counts only for a mouse (a tap never sticks it)', /pointerType === 'mouse'/.test(hero))
check('every slide the same height: the stage, not the copy, sets it', /\.xtell-hero-stage \{ position: relative; height: 330px;/.test(read('app/globals.css')))
check('the stage clips and can never scroll (focus on a dot scrolled it 23px), and a slide not shown yet draws only its wash', /\.xtell-hero-stage \{[^}]*overflow: hidden; overflow: clip;/.test(read('app/globals.css')) && /\? seen\.has\(i\) && <picture>/.test(hero))
check('易學堂 alone sets its phone crop (the whole bagua panel at 480px); every other picture keeps center bottom', HERO_ART.yixue?.focusPortrait === 'center 85%' && Object.entries(HERO_ART).every(([k, a]) => k === 'yixue' || !a?.focusPortrait)
  && /object-position: var\(--hero-portrait-focus, center bottom\)/.test(read('app/globals.css')) && /'--hero-portrait-focus': art\.focusPortrait/.test(hero))
check('phones get the portrait picture, narrow windows the small wide one', /<source media="\(max-width: 480px\)" srcSet=\{art\.srcPortrait\} \/>/.test(hero) && /<source media="\(max-width: 760px\)" srcSet=\{art\.srcMobile\} \/>/.test(hero) && /object-position: var\(--hero-portrait-focus, center bottom\)/.test(read('app/globals.css')))
check('the button names the temple without its gloss (one line on a phone)', /const short = name\.replace\(/.test(hero) && '夢占い（周公解夢）'.replace(/\s*[（(][^（）()]*[）)]\s*$/, '') === '夢占い' && '八字廟'.replace(/\s*[（(][^（）()]*[）)]\s*$/, '') === '八字廟')
check('controls are labelled buttons; the slide is aria-current; the live region is quiet while turning', /aria-label=\{t\('xtell\.home\.hero\.prev'\)\}/.test(hero) && /aria-current=\{i === index \? 'true' : undefined\}/.test(hero) && /aria-live=\{rotating \? 'off' : 'polite'\}/.test(hero))

// ── The top bar's preview mark ─────────────────────────────────────────────
const nav = read('app/components/xtell/XTellNav.tsx')
check('the hero\'s temple is marked data-preview, never aria-current, and not inside a room', /data-preview=\{!activeTemple && preview === key \? 'true' : undefined\}/.test(nav) && /aria-current=\{activeTemple === key \? 'page' : undefined\}/.test(nav))
check('the row follows the preview only when the icon is out of view and untouched for 8 s, scrolling the row alone', /Date\.now\(\) - touched\.current < 8000/.test(nav) && /el\.scrollTo\(\{ left: Math\.max\(0, left\)/.test(nav))
check('never against the visitor: the arrows count as a touch, and no follow while the pointer is on the row or focus is in it',
  /const scrollRow = \(dir: 1 \| -1\) => \{\s*touched\.current = Date\.now\(\)/.test(nav) && /hovering\.current \|\| wrap\.current\?\.contains\(document\.activeElement\)/.test(nav) && /<div ref=\{wrap\} className="xtell-temple-wrap">/.test(nav))
check('the hero says which temple, and forgets on leaving', /announcePreview\(current \?\? null\)/.test(hero) && /useEffect\(\(\) => \(\) => announcePreview\(null\), \[\]\)/.test(hero))

// ── Pinned temples (owner, Oct 3: instead of 我的常用) ────────────────────
check('pins: nothing saved, none', parsePins(null, KNOWN).length === 0 && parsePins('', KNOWN).length === 0)
check('pins: corrupt or foreign data reads as none', parsePins('{nope', KNOWN).length === 0 && parsePins('{"a":1}', KNOWN).length === 0 && parsePins('42', KNOWN).length === 0)
check('pins: only real temples, each once, in the saved order', parsePins(JSON.stringify(['tarot', 'evil', 'bazi', 'tarot', 7, null, 'guanyin']), KNOWN).join() === 'tarot,bazi,guanyin')
const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } }
check('pins: blocked storage is reported, never thrown', loadPins(throwing, KNOWN).ok === false && savePins(throwing, ['bazi']) === false && loadPins(null, KNOWN).ok === false)
const mem: Record<string, string> = {}
const memory = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v } }
check('pins: saved and read back under one versioned key', savePins(memory, ['zhanxing', 'tarot']) && mem[PINS_KEY] === '["zhanxing","tarot"]' && loadPins(memory, KNOWN).list.join() === 'zhanxing,tarot')
let pins: TempleKey[] = []
pins = pinTemple(pins, 'bazi'); pins = pinTemple(pins, 'tarot'); pins = pinTemple(pins, 'bazi')
check('pins: the newest pin goes to the very left, each temple once', pins.join() === 'bazi,tarot' && unpinTemple(pins, 'bazi').join() === 'tarot')
const market: TempleKey[] = ['bazi', 'ziwei', 'zhanxing', 'tarot', 'yixue']
check('top bar: pins first (newest leftmost), then the market order without them; unknown pins ignored', pinnedFirst(market, ['yixue', 'tarot']).join() === 'yixue,tarot,bazi,ziwei,zhanxing' && pinnedFirst(market, []).join() === market.join() && pinnedFirst(market, ['cookie' as TempleKey]).join() === market.join())
const navSrc = read('app/components/xtell/XTellNav.tsx'), pinBtn = read('app/components/xtell/PinButton.tsx'), usePinsSrc = read('app/components/xtell/usePins.ts')
check('the top bar reads the pins and marks the last pinned one (a thin rule after it)', /const order = pinnedFirst\(displayTemples\(lang\), pins \?\? \[\]\)/.test(navSrc) && /data-pinned=/.test(navSrc) && /a\[data-pinned="last"\]::after/.test(read('app/globals.css')))
check('each room has 釘選 (a toggle with aria-pressed), and the bar follows at once in this tab and others', /<PinButton temple=\{temple\} \/>/.test(read('app/xtell/client.tsx')) && /aria-pressed=\{pinned\}/.test(pinBtn) && /window\.dispatchEvent\(new Event\(PINS_EVENT\)\)/.test(usePinsSrc) && /addEventListener\('storage', onStorage\)/.test(usePinsSrc))
check('我的常用 is gone: no card, no strings, no styles', !fs.existsSync(path.join(__dirname, '..', 'app/components/xtell/XTellFavorites.tsx')) && !Object.keys(STRINGS).some(k => k.startsWith('xtell.fav.')) && !/xtell-fav/.test(read('app/globals.css')))

// ── The page ───────────────────────────────────────────────────────────────
const page = read('app/xtell/client.tsx')
check('homepage order: entrance, the guide right under it, today\'s two cards, then the steps', /<XTellHero \/>\s*<XTellAssistant onOpen=\{openFromGuide\} \/>\s*<div className="xtell-home-cards">[\s\S]*?\{almanacSection \?\? <AlmanacCard compact \/>\}\s*<XTellDaily openSignal=\{dailySignal\} onContinue=\{openDaily\} compact \/>\s*<\/div>\s*<XTellHowTo \/>\s*<\/> :/.test(page) && !/XTellExamples|XTellFavorites/.test(page))
check('one guide on the homepage, never told which temple is on show', (page.match(/<XTellAssistant /g) ?? []).length === 1 && !/<XTellAssistant[^>]*(temple|current)=/.test(page))
const as = read('app/components/xtell/XTellAssistant.tsx')
check('the comparison is over: no ?guide switch, no stored preference, no field in the hero', !/guidePlace|GUIDE_PLACE|xtell:guide-place|composerIn|onDraft|createPortal|guideSlot|has-guide|xtell-hero-guide/.test(page + as + hero + read('lib/xtell-hero.ts') + read('app/globals.css')))
check('the guide asks with its heading and a short example, and labels its field by that heading', /<h2 id=\{titleId\} className="xtell-as-title">\{t\('xtell\.as\.ask'\)\}<\/h2>/.test(as) && /placeholder=\{t\('xtell\.as\.placeholderShort'\)\} aria-labelledby=\{titleId\}/.test(as))
check('the chips and the note come with the first use and a blur never hides them (a tap on a chip lands)', /onFocus=\{\(\) => setEngaged\(true\)\}/.test(as) && !/setEngaged\(false\)/.test(as))
const today = read('app/components/xtell/XTellToday.tsx')
let daily = ''
const clamp = read('app/components/xtell/XTellClamp.tsx')
check('both cards load everything with the page and show five lines, the rest behind 更多 (owner, Oct 3)', /<XTellClamp>\{!data \? waiting : <>\{yiji\}/.test(today) && /\{facts\}<\/>\}<\/XTellClamp>/.test(today) && /<XTellClamp openSignal=\{openSignal\}>\{readings\}<\/XTellClamp>/.test(daily = read('app/components/xtell/XTellDaily.tsx'))
  && /\.xtell-clamp \{ position: relative; height: 8\.5em; overflow: hidden; font-size: 13\.5px; line-height: 1\.7; \}/.test(read('app/globals.css')) && /aria-expanded=\{open\} aria-controls=\{id\}/.test(clamp))
check('the day on top: the lunar line on 今日黃曆, the Gregorian date on 今日運勢; no 今天 or 每日免費 badges (owner, Oct 3)', /<p className="xtell-home-date">\{lunarLine \?\? /.test(today) && /const lunarLine = data && `\$\{fill\(t\('xtell\.today\.lunar'\)/.test(today) && /const dateLine = compact && <p className="xtell-home-date">/.test(daily) && !('xtell.home.today' in STRINGS) && !('xtell.home.daily.free' in STRINGS) && !/xtell-home-badge/.test(today + daily))
check('the box keeps its height (no jump as data arrives), and 更多 shows only when there is more', /\{\(more \|\| open\) && \(/.test(clamp) && /new ResizeObserver\(check\)/.test(clamp))
check('almanac: every fact is still there (彭祖 included), 宜 and 忌 first in the box on the homepage', /<li>\{t\('xtell\.today\.pengZu'\)\}/.test(today) && /waiting : <>\{yiji\}/.test(today))
check('daily: the sign-in buttons stay outside the box; the birth form takes the whole row; the guide\'s signal opens the box', /<\/XTellClamp>\s*\{actions\}/.test(daily) && /editing \? ' is-open' : ''/.test(daily) && /if \(!openSignal\) return\s*\n\s*sectionRef\.current\?\.scrollIntoView/.test(daily))
const howSrc = read('app/components/xtell/XTellHowTo.tsx')
const zh = (k: string) => (STRINGS[k] as any)?.['zh-Hant'] as string
check('the examples are gone (owner, Oct 3: not useful): no component, no strings', !fs.existsSync(path.join(__dirname, '..', 'app/components/xtell/XTellExamples.tsx')) && !Object.keys(STRINGS).some(k => k.startsWith('xtell.ex.')))
check('four steps (owner, Oct 3): choose a temple, give your details, choose masters, discuss the results with them', /const STEPS = \[1, 2, 3, 4\] as const/.test(howSrc) && zh('xtell.how.title') === '簡單幾個步驟，獲得您的專屬解讀' && zh('xtell.how.1.title') === '選擇殿堂' && zh('xtell.how.2.title') === '提供資料' && zh('xtell.how.3.title') === '選擇大師' && zh('xtell.how.4.title') === '與大師討論結果')

check('the guide is 嚮導 / 向导 wherever it names itself (owner, Oct 3: 導覽 is a process), and its heading asks the visitor to ask it',
  ['xtell.as.ask', 'xtell.as.asking', 'xtell.as.note', 'xtell.as.fail', 'xtell.as.carried'].every(k => /嚮導/.test((STRINGS[k] as any)['zh-Hant']) && !/導覽/.test((STRINGS[k] as any)['zh-Hant']) && /向导/.test((STRINGS[k] as any)['zh-Hans']))
  && zh('xtell.as.ask') === '不知道從哪裡開始？問問嚮導' && (STRINGS['xtell.as.ask'] as any).en === 'Not sure where to start? Ask our guide')
const css = read('app/globals.css')
check('touch targets: 32px around each small dot, 36px play, 36px pin button', /\.xtell-hero-dot \{ position: relative; width: 32px; height: 32px;/.test(css) && /\.xtell-hero-dot::before \{[^}]*width: 8px; height: 8px;/.test(css) && /\.xtell-hero-play \{ width: 36px; height: 36px;/.test(css) && /\.xtell-pin \{[^}]*min-height: 36px;/.test(css))
const howText = [1, 2, 3, 4].flatMap(n => ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].map(l => (STRINGS[`xtell.how.${n}.desc`] as any)[l] as string)).join(' ')
const how1 = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].map(l => (STRINGS['xtell.how.1.desc'] as any)[l] as string).join(' ')
check('step 1 does not say where the guide is', !/below|下方|下面|下の|아래/.test(how1))
check('the steps say what a visitor does, never how it is computed', !/code|calculat|計算|算好|系统|系統|계산/.test(howText))

// ── X先知 on www at /xtell (owner, Oct 4: no subdomains; www keeps its shell) ──
check('/xtell and below are www\'s XTell page; files under /xtell and look-alikes are not',
  isXTellPath('/xtell') && isXTellPath('/xtell/x') && !isXTellPath('/xtell/hero/bazi.webp') && !isXTellPath('/xtellx') && !isXTellPath('/') && !isXTellPath('/profile'))
check('links follow the base: the subdomain keeps /#bazi, www gets /xtell#bazi',
  templeHref('', 'bazi') === '/#bazi' && templeHref(XTELL_PATH, 'bazi') === '/xtell#bazi' && doorHome('') === '/' && doorHome(XTELL_PATH) === '/xtell')
const proxySrc = read('proxy.ts')
check('the proxy keeps /xtell on a non-door host in www\'s shell (a leftover ?site= cookie cannot make it a door)',
  /if \(siteOfHost\(host, null\) === 'modelxd' && isXTellPath\(req\.nextUrl\.pathname\)\) site = 'modelxd'/.test(proxySrc))
check('www stays behind its password: no /xtell exemption in the gate', !/startsWith\('\/xtell/.test(proxySrc.slice(proxySrc.indexOf('function isBypassed'), proxySrc.indexOf('function isBypassed') + 2000)))
check('www\'s shell everywhere on www: no copies of its pages under /xtell, no shell switch in the layout',
  ['profile', 'terms', 'privacy', 'tokushoho', 'login'].every(p => !fs.existsSync(path.join(__dirname, '..', 'app/xtell', p))) && !/XTELL_PATH|isXTellPath|site-base/.test(read('app/layout.tsx')))
check('on www the door\'s content sits under the temples row, links under /xtell, no XTell footer (the left nav has the logo and the account)',
  /const inWww = site !== 'xtell'/.test(page) && /<XTellBaseProvider base=\{inWww \? '\/xtell' : ''\}>/.test(page) && /\{inWww && <XTellNav user=\{null\} embedded \/>\}/.test(page) && /\{!inWww && <XTellFooter \/>\}/.test(page)
  && /<XTellClient standalone /.test(read('app/xtell/page.tsx')))
check('the embedded row is not .xtell-nav (that switches the page to the door\'s layout), sticks under the phone\'s top bar, in the door\'s colours',
  /if \(embedded\) return <div className="xtell-embedded-bar">\{strip\}<\/div>/.test(nav) && /\.xtell-embedded-bar \{ position: sticky; top: 0;/.test(css) && /@media \(max-width: 760px\) \{ \.xtell-embedded-bar \{ top: 60px;/.test(css) && /html\[data-site="xtell"\] \.xtell-auth, \.xtell-site\.is-in-www \{/.test(css))
check('the temples row follows the base', /href=\{templeHref\(base, key\)\}/.test(nav) && /href=\{doorHome\(base\)\}/.test(nav) && /a\[href="\$\{templeHref\(base, activeTemple\)\}"\]/.test(nav))
const profileSrc = read('app/profile/page.tsx')
check('www\'s account page has an X先知 tab (settings + saved visits, a visit opens on /xtell), opened by the settings links\' #xtell-… hash',
  /\['xtell', '☯ ' \+ t\('nav\.xtell'\)\]/.test(profileSrc) && /<XTellActivity userId=\{user\.id\} basePath="\/xtell" \/>/.test(profileSrc) && /window\.location\.hash\.startsWith\('#xtell'\)\) setTab\('xtell'\)/.test(profileSrc))
check('the sidebar link is open to guests, as on xtell.modelxd.com (the free chart needs no account)', /\{ href: '\/xtell', +i18n: 'nav\.xtell', +protected: false,/.test(read('app/components/Nav.tsx')))
check('inside a temple the sidebar\'s X先知 link goes back to the street in place (a Link push dropped the hash and left the temple open)',
  /if \(href === '\/xtell' && pathname === '\/xtell' && window\.location\.hash\) \{\s*e\.preventDefault\(\)\s*setMenuOpen\(false\)\s*window\.location\.hash = ''/.test(read('app/components/Nav.tsx')))
check('signing in from a temple on www comes back to that temple (/xtell#bazi), as on the door',
  /isXTell \|\| isXTellPath\(window\.location\.pathname\) \? window\.location\.hash : ''/.test(read('app/components/AuthModal.tsx')))

// ── Every string in every language ─────────────────────────────────────────
const used = new Set<string>()
for (const src of [hero, pinBtn, clamp, howSrc, today, daily]) for (const m of src.matchAll(/t\('((?:xtell\.(?:home|pin|how))[^']*)'\)/g)) used.add(m[1])
for (const k of ['xtell.pin.on', 'xtell.pin.off', 'xtell.pin.hint', 'xtell.pin.unhint', 'xtell.home.more', 'xtell.home.less']) used.add(k)
used.add('xtell.as.ask'); used.add('xtell.as.placeholderShort')
for (const n of [1, 2, 3, 4]) { used.add(`xtell.how.${n}.title`); used.add(`xtell.how.${n}.desc`) }
const missing = [...used].filter(k => !['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].every(l => typeof (STRINGS[k] as any)?.[l] === 'string' && (STRINGS[k] as any)[l].length > 0))
check(`all ${used.size} homepage strings exist in en, zh-Hant, zh-Hans, ja and ko`, missing.length === 0, missing.join(', '))

console.log(fails ? `\n${fails} FAILED` : '\nall ok')
process.exit(fails ? 1 : 0)
