// scripts/test-xtell-home.ts — the XTell homepage (Oct 3, the owner's approved
// Concept 24): the turning entrance, the top bar's preview mark, today's
// cards, 我的常用 and the four steps. Pure logic, plus the source
// checks that guard the promises (turning never navigates; nothing is
// never testimonials; nothing pre-filled). No network, no browser.
//   npx tsx scripts/test-xtell-home.ts

import fs from 'node:fs'
import path from 'node:path'
import { heroTemples, stepSlide, mayRotate, HERO_ART, HERO_SLIDES, HERO_FEATURED } from '../lib/xtell-hero'
import { parseFavorites, loadFavorites, saveFavorites, addFavorite, removeFavorite, moveFavorite, FAVORITES_KEY } from '../lib/xtell-favorites'
import { displayTemples, type TempleKey } from '../app/components/xtell/TempleArtwork'
import { STRINGS } from '../lib/i18n'

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
// 易學堂 joined the Chinese rotation on Oct 3 before Codex had painted its
// portrait; it shows the narrow scene on phones until the file arrives.
const AWAITING_PORTRAIT: TempleKey[] = ['yixue']
check(`every featured temple (${featured.length}) has its portrait composition for phones (awaiting: ${AWAITING_PORTRAIT.join()})`, featured.every(k => !!HERO_ART[k]?.srcPortrait || AWAITING_PORTRAIT.includes(k)), featured.filter(k => !HERO_ART[k]?.srcPortrait && !AWAITING_PORTRAIT.includes(k)).join(', '))
check('slides wrap both ways', stepSlide(5, 1, 6) === 0 && stepSlide(0, -1, 6) === 5 && stepSlide(2, 0, 6) === 2 && stepSlide(0, 1, 0) === 0)
const still = { paused: false, hovered: false, focused: false, hidden: false, reducedMotion: false, count: 6 }
check('turns by itself only when nothing holds it', mayRotate(still))
check('held by: a person\'s choice, the pointer, keyboard focus, a hidden tab, less motion, a single slide',
  !mayRotate({ ...still, paused: true }) && !mayRotate({ ...still, hovered: true }) && !mayRotate({ ...still, focused: true })
  && !mayRotate({ ...still, hidden: true }) && !mayRotate({ ...still, reducedMotion: true }) && !mayRotate({ ...still, count: 1 }))

const hero = read('app/components/xtell/XTellHero.tsx')
check('turning never navigates, routes, fetches or writes the address', !/location\.hash|history\.|useRouter|router\.|fetch\(|replaceState|pushState/.test(hero))
check('the timer only moves the slide', /setTimeout\(\(\) => setIndex\(i => stepSlide\(i, 1, count\)\), HERO_SECONDS \* 1000\)/.test(hero))
check('entering is a real link into the temple', /<a className="xtell-hero-enter" href=\{'\/#' \+ current\}>/.test(hero))
check('any slide choice pauses; play is a toggle; reduced motion holds from the start until play', /const choose = \(i: number\) => \{ setIndex\(stepSlide\(i, 0, count\)\); setPaused\(true\) \}/.test(hero) && /reducedMotion: reducedMotion && !played/.test(hero))
check('hover counts only for a mouse (a tap never sticks it)', /pointerType === 'mouse'/.test(hero))
check('every slide the same height: the stage, not the copy, sets it', /\.xtell-hero-stage \{ position: relative; height: 330px;/.test(read('app/globals.css')))
check('the stage clips and can never scroll (focus on a dot scrolled it 23px), and a slide not shown yet draws only its wash', /\.xtell-hero-stage \{[^}]*overflow: hidden; overflow: clip;/.test(read('app/globals.css')) && /\? seen\.has\(i\) && <picture>/.test(hero))
check('phones get the portrait picture, narrow windows the small wide one', /<source media="\(max-width: 480px\)" srcSet=\{art\.srcPortrait\} \/>/.test(hero) && /<source media="\(max-width: 760px\)" srcSet=\{art\.srcMobile\} \/>/.test(hero) && /object-position: center bottom/.test(read('app/globals.css')))
check('the button names the temple without its gloss (one line on a phone)', /const short = name\.replace\(/.test(hero) && '夢占い（周公解夢）'.replace(/\s*[（(][^（）()]*[）)]\s*$/, '') === '夢占い' && '八字廟'.replace(/\s*[（(][^（）()]*[）)]\s*$/, '') === '八字廟')
check('controls are labelled buttons; the slide is aria-current; the live region is quiet while turning', /aria-label=\{t\('xtell\.home\.hero\.prev'\)\}/.test(hero) && /aria-current=\{i === index \? 'true' : undefined\}/.test(hero) && /aria-live=\{rotating \? 'off' : 'polite'\}/.test(hero))

// ── The top bar's preview mark ─────────────────────────────────────────────
const nav = read('app/components/xtell/XTellNav.tsx')
check('the hero\'s temple is marked data-preview, never aria-current, and not inside a room', /data-preview=\{!activeTemple && preview === key \? 'true' : undefined\}/.test(nav) && /aria-current=\{activeTemple === key \? 'page' : undefined\}/.test(nav))
check('the row follows the preview only when the icon is out of view and untouched for 8 s, scrolling the row alone', /Date\.now\(\) - touched\.current < 8000/.test(nav) && /el\.scrollTo\(\{ left: Math\.max\(0, left\)/.test(nav))
check('never against the visitor: the arrows count as a touch, and no follow while the pointer is on the row or focus is in it',
  /const scrollRow = \(dir: 1 \| -1\) => \{\s*touched\.current = Date\.now\(\)/.test(nav) && /hovering\.current \|\| wrap\.current\?\.contains\(document\.activeElement\)/.test(nav) && /<div ref=\{wrap\} className="xtell-temple-wrap">/.test(nav))
check('the hero says which temple, and forgets on leaving', /announcePreview\(current \?\? null\)/.test(hero) && /useEffect\(\(\) => \(\) => announcePreview\(null\), \[\]\)/.test(hero))

// ── 我的常用 ───────────────────────────────────────────────────────────────
check('favorites: nothing saved, empty', parseFavorites(null, KNOWN).length === 0 && parseFavorites('', KNOWN).length === 0)
check('favorites: corrupt or foreign data reads as empty', parseFavorites('{nope', KNOWN).length === 0 && parseFavorites('{"a":1}', KNOWN).length === 0 && parseFavorites('42', KNOWN).length === 0)
check('favorites: only real temples, each once, in the saved order', parseFavorites(JSON.stringify(['tarot', 'evil', 'bazi', 'tarot', 7, null, 'guanyin']), KNOWN).join() === 'tarot,bazi,guanyin')
const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } }
check('favorites: blocked storage is reported, never thrown', loadFavorites(throwing, KNOWN).ok === false && saveFavorites(throwing, ['bazi']) === false && loadFavorites(null, KNOWN).ok === false)
const mem: Record<string, string> = {}
const memory = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v } }
check('favorites: saved and read back under one versioned key', saveFavorites(memory, ['zhanxing', 'tarot']) && mem[FAVORITES_KEY] === '["zhanxing","tarot"]' && loadFavorites(memory, KNOWN).list.join() === 'zhanxing,tarot')
let fav: TempleKey[] = []
fav = addFavorite(fav, 'bazi'); fav = addFavorite(fav, 'tarot'); fav = addFavorite(fav, 'guanyin'); fav = addFavorite(fav, 'tarot')
check('favorites: add once each', fav.join() === 'bazi,tarot,guanyin')
check('favorites: reorder, unchanged at the ends', moveFavorite(fav, 'guanyin', -1).join() === 'bazi,guanyin,tarot' && moveFavorite(fav, 'bazi', -1).join() === fav.join() && moveFavorite(fav, 'guanyin', 1).join() === fav.join())
check('favorites: remove', removeFavorite(fav, 'tarot').join() === 'bazi,guanyin')
const favSrc = read('app/components/xtell/XTellFavorites.tsx')
check('favorites: removing the last one ends editing, and 完成 stays while editing (never trapped without 新增)', /if \(next\.length === 0\) setEditing\(false\)/.test(favSrc) && /\{list && \(list\.length > 0 \|\| editing\) && \(/.test(favSrc))
check('favorites: nothing pre-filled (only what this device saved), original icons, real links, keyboard reorder', /useState<TempleKey\[\] \| null>\(null\)/.test(favSrc) && /loadFavorites\(deviceStore\(\), TEMPLES\)/.test(favSrc) && /kind="icon" clear/.test(favSrc) && /href=\{'\/#' \+ k\}/.test(favSrc) && /moveFavorite\(list, k, -1\)/.test(favSrc))

// ── The page ───────────────────────────────────────────────────────────────
const page = read('app/xtell/client.tsx')
check('homepage order: entrance, the guide right under it, today\'s three cards, then the four steps (no examples)', /<XTellHero \/>\s*<XTellAssistant onOpen=\{openFromGuide\} \/>\s*<div className="xtell-home-cards">[\s\S]*?\{almanacSection \?\? <AlmanacCard compact \/>\}\s*<XTellDaily openSignal=\{dailySignal\} onContinue=\{openDaily\} compact \/>\s*<XTellFavorites \/>\s*<\/div>\s*<XTellHowTo \/>\s*<\/> :/.test(page) && !/XTellExamples/.test(page))
check('one guide on the homepage, never told which temple is on show', (page.match(/<XTellAssistant /g) ?? []).length === 1 && !/<XTellAssistant[^>]*(temple|current)=/.test(page))
const as = read('app/components/xtell/XTellAssistant.tsx')
check('the comparison is over: no ?guide switch, no stored preference, no field in the hero', !/guidePlace|GUIDE_PLACE|xtell:guide-place|composerIn|onDraft|createPortal|guideSlot|has-guide|xtell-hero-guide/.test(page + as + hero + read('lib/xtell-hero.ts') + read('app/globals.css')))
check('the guide asks with its heading and a short example, and labels its field by that heading', /<h2 id=\{titleId\} className="xtell-as-title">\{t\('xtell\.as\.ask'\)\}<\/h2>/.test(as) && /placeholder=\{t\('xtell\.as\.placeholderShort'\)\} aria-labelledby=\{titleId\}/.test(as))
check('the chips and the note come with the first use and a blur never hides them (a tap on a chip lands)', /onFocus=\{\(\) => setEngaged\(true\)\}/.test(as) && !/setEngaged\(false\)/.test(as))
const today = read('app/components/xtell/XTellToday.tsx')
check('almanac: compact first (date, 宜, 忌), every detail one press away, same data', /if \(compact && !open\) return \(/.test(today) && /onClick=\{\(\) => setOpen\(true\)\}>\{t\('xtell\.home\.almanac\.more'\)\}/.test(today) && /<li>\{t\('xtell\.today\.pengZu'\)\}/.test(today))
const daily = read('app/components/xtell/XTellDaily.tsx')
check('daily: the same card and logic, compact until opened; the guide\'s signal opens it', /compact && !open \? \(/.test(daily) && /setOpen\(true\)\s*\n\s*sectionRef\.current\?\.scrollIntoView/.test(daily))
const howSrc = read('app/components/xtell/XTellHowTo.tsx')
const zh = (k: string) => (STRINGS[k] as any)?.['zh-Hant'] as string
check('the examples are gone (owner, Oct 3: not useful): no component, no strings', !fs.existsSync(path.join(__dirname, '..', 'app/components/xtell/XTellExamples.tsx')) && !Object.keys(STRINGS).some(k => k.startsWith('xtell.ex.')))
check('four steps (owner, Oct 3): choose a temple, give your details, choose masters, discuss the results with them', /const STEPS = \[1, 2, 3, 4\] as const/.test(howSrc) && zh('xtell.how.title') === '簡單幾個步驟，獲得您的專屬解讀' && zh('xtell.how.1.title') === '選擇殿堂' && zh('xtell.how.2.title') === '提供資料' && zh('xtell.how.3.title') === '選擇大師' && zh('xtell.how.4.title') === '與大師討論結果')

check('the guide is 嚮導 / 向导 wherever it names itself (owner, Oct 3: 導覽 is a process), and its heading asks the visitor to ask it',
  ['xtell.as.ask', 'xtell.as.asking', 'xtell.as.note', 'xtell.as.fail', 'xtell.as.carried'].every(k => /嚮導/.test((STRINGS[k] as any)['zh-Hant']) && !/導覽/.test((STRINGS[k] as any)['zh-Hant']) && /向导/.test((STRINGS[k] as any)['zh-Hans']))
  && zh('xtell.as.ask') === '不知道從哪裡開始？問問嚮導' && (STRINGS['xtell.as.ask'] as any).en === 'Not sure where to start? Ask our guide')
const css = read('app/globals.css')
check('touch targets: 32px around each small dot, 36px play, 34px edit tools', /\.xtell-hero-dot \{ position: relative; width: 32px; height: 32px;/.test(css) && /\.xtell-hero-dot::before \{[^}]*width: 8px; height: 8px;/.test(css) && /\.xtell-hero-play \{ width: 36px; height: 36px;/.test(css) && /\.xtell-fav-tools button \{ width: 34px; height: 34px;/.test(css))
const howText = [1, 2, 3, 4].flatMap(n => ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].map(l => (STRINGS[`xtell.how.${n}.desc`] as any)[l] as string)).join(' ')
const how1 = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].map(l => (STRINGS['xtell.how.1.desc'] as any)[l] as string).join(' ')
check('step 1 does not say where the guide is', !/below|下方|下面|下の|아래/.test(how1))
check('the steps say what a visitor does, never how it is computed', !/code|calculat|計算|算好|系统|系統|계산/.test(howText))

// ── Every string in every language ─────────────────────────────────────────
const used = new Set<string>()
for (const src of [hero, favSrc, howSrc, today, daily]) for (const m of src.matchAll(/t\('((?:xtell\.(?:home|fav|how))[^']*)'\)/g)) used.add(m[1])
used.add('xtell.as.ask'); used.add('xtell.as.placeholderShort')
for (const n of [1, 2, 3, 4]) { used.add(`xtell.how.${n}.title`); used.add(`xtell.how.${n}.desc`) }
const missing = [...used].filter(k => !['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].every(l => typeof (STRINGS[k] as any)?.[l] === 'string' && (STRINGS[k] as any)[l].length > 0))
check(`all ${used.size} homepage strings exist in en, zh-Hant, zh-Hans, ja and ko`, missing.length === 0, missing.join(', '))

console.log(fails ? `\n${fails} FAILED` : '\nall ok')
process.exit(fails ? 1 : 0)
