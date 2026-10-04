// lib/xtell-hero.ts — the XTell homepage hero (Oct 3, the owner's approved
// Concept 24): which temples are featured, and the art behind each.
//
// The art is an inventory, kept apart from what is featured. HERO_ART lists
// every temple that has a scenic background (13 on Oct 3, painted by Codex:
// public/xtell/hero/<temple>.webp, 1881 wide, and <temple>-mobile.webp, 960
// wide), plus a portrait composition for phones (<temple>-portrait-mobile
// .webp, 960 wide, mostly 960x1280; Codex's second pass: the wide scenes
// cropped to a phone lost their subjects at the edges; 易學堂's, 960x1440,
// came on Oct 4 when it joined the Chinese rotation). The hero features the first HERO_SLIDES of them in each
// market's own order (displayTemples), so a new background never adds a dot;
// it only steps in when a temple ahead of it in that market has no art.
// Chinese has a hand-picked list instead (HERO_FEATURED).
// A temple without `src` (none today) draws a soft wash in its colours with
// its existing portrait art. The wash is also what shows while a picture
// loads, so it is each picture's own colours (the middle the phone shows).
//
// Nothing here navigates: entering a temple is the hero's own link.

import { displayTemples, type TempleKey } from '../app/components/xtell/TempleArtwork'

export type HeroArt = {
  /** Wide background with a quiet centre for the title. */
  src?: string
  /** The same scene, smaller, for narrow windows (max-width 760px). */
  srcMobile?: string
  /** A portrait composition for phones (max-width 480px), cropped from the bottom. */
  srcPortrait?: string
  /** Where the phone crop sits when the bottom is wrong for a picture (CSS
   *  object-position, phones only); unset = center bottom. */
  focusPortrait?: string
  /** CSS object-position for the background. */
  focus?: string
  /** Its colours, top then bottom: under the picture while it loads, and behind the fallback. */
  wash: [string, string]
}

/** How many temples the hero features per market. */
export const HERO_SLIDES = 6

/** Markets whose featured temples are chosen by hand instead of the top
 *  bar's first six with art (owner, Oct 3): in Chinese, 易經, 孫子兵法 and
 *  周公解夢 are popular in Taiwan, and the Indian 九曜 and Japanese 九星 are
 *  left out. Shown in the top bar's order. */
export const HERO_FEATURED: Partial<Record<string, readonly TempleKey[]>> = {
  'zh-Hant': ['bazi', 'ziwei', 'zhanxing', 'tarot', 'yixue', 'jiemeng', 'sunzi'],
  'zh-Hans': ['bazi', 'ziwei', 'zhanxing', 'tarot', 'yixue', 'jiemeng', 'sunzi'],
}

const scenic = (key: TempleKey, wash: [string, string]): HeroArt => ({
  src: `/xtell/hero/${key}.webp`, srcMobile: `/xtell/hero/${key}-mobile.webp`,
  srcPortrait: `/xtell/hero/${key}-portrait-mobile.webp`, wash,
})

export const HERO_ART: Partial<Record<TempleKey, HeroArt>> = {
  bazi: scenic('bazi', ['#efe5d9', '#dfcbb7']),
  ziwei: scenic('ziwei', ['#d0c2d4', '#d8b5a8']),
  zhanxing: scenic('zhanxing', ['#9eafc9', '#8d8486']),
  tarot: scenic('tarot', ['#eaceb9', '#98665a']),
  navagraha: scenic('navagraha', ['#eadfd3', '#b18f72']),
  kyusei: scenic('kyusei', ['#dadadb', '#b2a59e']),
  jiemeng: scenic('jiemeng', ['#d6cee3', '#d1b9bd']),
  guanyin: scenic('guanyin', ['#d1bf9c', '#beae98']),
  xingming: scenic('xingming', ['#e8e1d8', '#d2bfac']),
  yuelao: scenic('yuelao', ['#f6ddca', '#cca589']),
  sunzi: scenic('sunzi', ['#f5e1c3', '#af9277']),
  cookie: scenic('cookie', ['#f0eee7', '#d4be9f']),
  // Bottom-anchored, wider phones lost the top of the bagua panel (Codex,
  // Oct 4); 85% keeps the whole panel and the open book at 320-480px.
  yixue: { ...scenic('yixue', ['#e5ddc9', '#c4aa8e']), focusPortrait: 'center 85%' },
}

/** The featured temples, in the market's own top-bar order: the market's
 *  hand-picked list where it has one, otherwise the first HERO_SLIDES with art. */
export function heroTemples(lang: string, art: Partial<Record<TempleKey, HeroArt>> = HERO_ART, slides = HERO_SLIDES): TempleKey[] {
  const chosen = HERO_FEATURED[lang]
  if (chosen) return displayTemples(lang).filter(key => chosen.includes(key) && !!art[key])
  return displayTemples(lang).filter(key => !!art[key]).slice(0, slides)
}

/** Seconds per slide when rotating. */
export const HERO_SECONDS = 7

/** The next slide, wrapping both ways. */
export const stepSlide = (index: number, by: number, count: number): number =>
  count > 0 ? ((index + by) % count + count) % count : 0

/** Whether the hero may turn by itself right now. Every reason to hold it
 *  still is listed: a person chose a slide (paused), the pointer or keyboard
 *  focus is on it, the tab is hidden, or the visitor asked for less motion. */
export const mayRotate = (s: { paused: boolean; hovered: boolean; focused: boolean; hidden: boolean; reducedMotion: boolean; count: number }): boolean =>
  !s.paused && !s.hovered && !s.focused && !s.hidden && !s.reducedMotion && s.count > 1
