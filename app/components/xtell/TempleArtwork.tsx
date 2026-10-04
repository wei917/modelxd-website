import type { CSSProperties } from 'react'

export type TempleKey = 'bazi' | 'ziwei' | 'yuelao' | 'guandi' | 'mazu' | 'simianfo' | 'navagraha' | 'zhanxing' | 'xingming' | 'cezi' | 'yixue' | 'jiemeng' | 'guanyin' | 'tarot' | 'cookie' | 'kyusei' | 'sukuyo' | 'sunzi'
// Menu order (owner, Sep 24: 有技術的放前面): the computed methods first —
// 八字, 紫微, 西洋占星, 吠陀占星, 姓名, 測字 — then the deity rooms. The art
// sheets keep their own five-by-two order via TEMPLE_ART below, so this list
// is display order only.
// 易學堂 (Sep 26) sits with the computed methods, after 測字; 解夢 (Sep 27),
// a reading of the visitor's own words like 測字, after it.
// 塔羅 (Sep 28) sits by 占星 with the draws people know; 觀音 leads the
// deity rooms, the most visited temple in Taiwan.
// 九星氣學 (Sep 29) sits with the computed methods, after 九曜. 孫子兵法
// (Sep 29), a reading of the visitor's own words like 解夢, after it.
// Oct 3 (owner): the Chinese bar starts with the homepage's rotation, in
// its order — 易經, 周公解夢 and 孫子兵法 are popular in Taiwan, so they come
// right after 塔羅, ahead of the Indian 九曜 and the Japanese 九星 and 宿曜
// (lib/xtell-hero.ts HERO_FEATURED; a test keeps the two in step).
export const DISPLAY_TEMPLES: TempleKey[] = ['bazi', 'ziwei', 'zhanxing', 'tarot', 'yixue', 'jiemeng', 'sunzi', 'navagraha', 'kyusei', 'sukuyo', 'xingming', 'cezi', 'cookie', 'guanyin', 'yuelao', 'guandi', 'mazu', 'simianfo']

// Each market's own order (owner, Sep 28: "for each market, a list and
// order"). Every temple is in every list; only the order changes. Korea
// leads with 사주, 궁합 and 타로. Chinese keeps the order above.
// Oct 2 (owner: "optimize the temple order on the top nav bar for different
// countries"), Japan by what Japanese people search for most (Keyword
// Planner, Japan, Sep 30, a month): 夢占い and おみくじ 246,000 each,
// 姓名判断 135,000, ホロスコープ 90,500, タロット, 四柱推命 and 九星気学
// 74,000 each, 宿曜 33,100. The rooms Japanese visitors rarely know (関帝,
// 媽祖, 四面仏, 字占い) stay last: a Japanese visitor read the page as a
// Taiwanese site translated.
const ORDER_JA: TempleKey[] = ['jiemeng', 'guanyin', 'xingming', 'zhanxing', 'tarot', 'bazi', 'kyusei', 'yuelao', 'sukuyo', 'yixue', 'ziwei', 'sunzi', 'cookie', 'navagraha', 'guandi', 'mazu', 'simianfo', 'cezi']
const ORDER_KO: TempleKey[] = ['bazi', 'yuelao', 'tarot', 'zhanxing', 'jiemeng', 'sunzi', 'cookie', 'xingming', 'yixue', 'ziwei', 'guanyin', 'guandi', 'mazu', 'navagraha', 'kyusei', 'sukuyo', 'simianfo', 'cezi']
// English (the United States; Oct 2, same request): what English speakers
// look for first, tarot, astrology and dream meanings, then Chinese
// astrology (BaZi), love compatibility, the fortune cookie they know and the
// I Ching. The rooms that need Chinese characters or names (姓名, 測字) and
// the Japanese 宿曜 go last.
const ORDER_EN: TempleKey[] = ['tarot', 'zhanxing', 'jiemeng', 'bazi', 'yuelao', 'cookie', 'yixue', 'navagraha', 'sunzi', 'ziwei', 'kyusei', 'guanyin', 'guandi', 'mazu', 'simianfo', 'sukuyo', 'xingming', 'cezi']
export function displayTemples(lang: string): TempleKey[] {
  return lang === 'ja' ? ORDER_JA : lang === 'ko' ? ORDER_KO : lang === 'en' ? ORDER_EN : DISPLAY_TEMPLES
}

// Both approved image sheets use the same five-column, two-row ordering.
// A temple added after the sheets (易學堂) brings its own two files instead,
// so the approved sheets never change: `src` rather than `index`.
type Art = { index: number; caption: string; kind?: undefined; src?: undefined }
  | { src: { portrait: string; icon: string; iconClear: string }; caption: string; kind: 'object' | 'deity'; index?: undefined }
export const TEMPLE_ART: Record<TempleKey, Art> = {
  mazu: { index: 0, caption: 'MAZU' }, guandi: { index: 1, caption: 'GUAN DI' },
  yuelao: { index: 2, caption: 'YUE LAO' }, simianfo: { index: 3, caption: 'BRAHMA' },
  navagraha: { index: 4, caption: 'NAVAGRAHA' }, bazi: { index: 5, caption: 'FOUR PILLARS' },
  ziwei: { index: 6, caption: 'ZI WEI DOU SHU' }, xingming: { index: 7, caption: 'NAME STUDY' },
  cezi: { index: 8, caption: 'CHARACTER READING' }, zhanxing: { index: 9, caption: 'ASTROLOGY' },
  // Owner-selected B: ink-wash bagua and an open book. See
  // docs/XTELL-YIXUE-ART.md for provenance and trigram review.
  // Decoration only; the room draws real hexagrams from code.
  yixue: { src: { portrait: '/xtell/approved/yixue-school-portrait.avif', icon: '/xtell/approved/yixue-school-icon.avif', iconClear: '/xtell/approved/yixue-school-icon-clear.avif' }, caption: 'I CHING', kind: 'object' },
  // 解夢 (owner, Sep 27): a young woman asleep on a porcelain pillow, the
  // dream cloud with the moon and 莊周's butterfly (an old scholar was the first
  // draft; the owner asked for a young woman dreaming). Generated in XCreate (GPT Image
  // 2.5) against the approved sheets as a style reference; see docs/XTELL-PAGE.md.
  jiemeng: { src: { portrait: '/xtell/approved/jiemeng-portrait.avif', icon: '/xtell/approved/jiemeng-icon.avif', iconClear: '/xtell/approved/jiemeng-icon-clear.avif' }, caption: 'DREAMS', kind: 'deity' },
  // 觀音 and 塔羅 (Sep 28): generated in XCreate against the approved sheets
  // as a style reference, like 解夢; see docs/XTELL-PAGE.md.
  guanyin: { src: { portrait: '/xtell/approved/guanyin-portrait.avif', icon: '/xtell/approved/guanyin-icon.avif', iconClear: '/xtell/approved/guanyin-icon-clear.avif' }, caption: 'GUANYIN', kind: 'deity' },
  tarot: { src: { portrait: '/xtell/approved/tarot-portrait.avif', icon: '/xtell/approved/tarot-icon.avif', iconClear: '/xtell/approved/tarot-icon-clear.avif' }, caption: 'TAROT', kind: 'object' },
  cookie: { src: { portrait: '/xtell/approved/cookie-portrait.avif', icon: '/xtell/approved/cookie-icon.avif', iconClear: '/xtell/approved/cookie-icon-clear.avif' }, caption: 'FORTUNE COOKIE', kind: 'object' },
  // 九星気学 (Sep 29): the nine-star board on a compass rose. Generated like
  // 觀音's; the discs were then recoloured in code into the real 定位盤 (南
  // on top: 四緑 九紫 二黒 / 三碧 五黄 七赤 / 八白 一白 六白). See docs/XTELL-PAGE.md.
  // 宿曜占星術 (Sep 29): a crescent in a night circle ringed by the twenty-
  // seven mansions, over a sutra scroll. Generated like 觀音's (GPT Image 2.5
  // Sunburst against the object icons); the ring was then redrawn in code
  // with exactly 27 stars. See docs/XTELL-PAGE.md.
  sukuyo: { src: { portrait: '/xtell/approved/sukuyo-portrait.avif', icon: '/xtell/approved/sukuyo-icon.avif', iconClear: '/xtell/approved/sukuyo-icon-clear.avif' }, caption: 'SUKUYO', kind: 'object' },
  // 孫子兵法 (Sep 29): the owner's icon, a red war banner over a shield and
  // rock with 「孫子兵法」 below; see docs/XTELL-PAGE.md.
  sunzi: { src: { portrait: '/xtell/approved/sunzi-portrait.avif', icon: '/xtell/approved/sunzi-icon.avif', iconClear: '/xtell/approved/sunzi-icon-clear.avif' }, caption: 'ART OF WAR', kind: 'object' },
  kyusei: { src: { portrait: '/xtell/approved/kyusei-portrait.avif', icon: '/xtell/approved/kyusei-icon.avif', iconClear: '/xtell/approved/kyusei-icon-clear.avif' }, caption: 'NINE STAR KI', kind: 'object' },
}

/** 'object' portraits (the lower sheet row, and 易學堂) sit differently from the deities. */
export const artKind = (temple: TempleKey): 'object' | 'deity' => {
  const a = TEMPLE_ART[temple]
  return a.kind ?? ((a.index ?? 0) >= 5 ? 'object' : 'deity')
}

/** `clear`: an icon without its paper square, for white surfaces (the top
 *  bar). The same approved art with only the surrounding paper removed
 *  (scripts/xtell-clear-icons.mjs); on paper, use the original. */
export function TempleArtwork({ temple, kind = 'portrait', className = '', label, clear = false }: {
  temple: TempleKey; kind?: 'portrait' | 'icon'; className?: string; label?: string; clear?: boolean
}) {
  const art = TEMPLE_ART[temple]
  const clearIcon = clear && kind === 'icon'
  const style: CSSProperties = art.src
    ? { backgroundImage: `url('${clearIcon ? art.src.iconClear : art.src[kind]}')`, backgroundSize: kind === 'icon' || temple === 'yixue' ? 'contain' : 'cover', backgroundPosition: 'center' }
    : { backgroundPosition: ((art.index % 5) * 25) + '% ' + (art.index < 5 ? '0%' : '100%') }
  return <span className={'xtell-artwork xtell-artwork-' + kind + (clearIcon ? ' is-clear' : '') + ' ' + className} style={style}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}
