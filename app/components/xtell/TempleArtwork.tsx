import type { CSSProperties } from 'react'

export type TempleKey = 'bazi' | 'ziwei' | 'yuelao' | 'guandi' | 'mazu' | 'simianfo' | 'navagraha' | 'zhanxing' | 'xingming' | 'cezi' | 'yixue'
// Menu order (owner, Sep 24: 有技術的放前面): the computed methods first —
// 八字, 紫微, 西洋占星, 吠陀占星, 姓名, 測字 — then the deity rooms. The art
// sheets keep their own five-by-two order via TEMPLE_ART below, so this list
// is display order only.
// 易學堂 (Sep 26) sits with the computed methods, after 測字.
export const DISPLAY_TEMPLES: TempleKey[] = ['bazi', 'ziwei', 'zhanxing', 'navagraha', 'xingming', 'cezi', 'yixue', 'yuelao', 'guandi', 'mazu', 'simianfo']

// Both approved image sheets use the same five-column, two-row ordering.
// A temple added after the sheets (易學堂) brings its own two files instead,
// so the approved sheets never change: `src` rather than `index`.
type Art = { index: number; caption: string; kind?: undefined; src?: undefined }
  | { src: { portrait: string; icon: string }; caption: string; kind: 'object' | 'deity'; index?: undefined }
export const TEMPLE_ART: Record<TempleKey, Art> = {
  mazu: { index: 0, caption: 'MAZU' }, guandi: { index: 1, caption: 'GUAN DI' },
  yuelao: { index: 2, caption: 'YUE LAO' }, simianfo: { index: 3, caption: 'BRAHMA' },
  navagraha: { index: 4, caption: 'NAVAGRAHA' }, bazi: { index: 5, caption: 'FOUR PILLARS' },
  ziwei: { index: 6, caption: 'ZI WEI DOU SHU' }, xingming: { index: 7, caption: 'NAME STUDY' },
  cezi: { index: 8, caption: 'CHARACTER READING' }, zhanxing: { index: 9, caption: 'ASTROLOGY' },
  // Codex's standalone art, Sep 26 (provenance: artwork-prompts.md beside
  // the originals in Codex's yixuetang-launch output): six solid bars on a
  // tablet and three coins. Decoration only; the room draws real hexagrams
  // from code.
  yixue: { src: { portrait: '/xtell/approved/yixue-portrait.avif', icon: '/xtell/approved/yixue-icon.avif' }, caption: 'I CHING', kind: 'object' },
}

/** 'object' portraits (the lower sheet row, and 易學堂) sit differently from the deities. */
export const artKind = (temple: TempleKey): 'object' | 'deity' => {
  const a = TEMPLE_ART[temple]
  return a.kind ?? ((a.index ?? 0) >= 5 ? 'object' : 'deity')
}

export function TempleArtwork({ temple, kind = 'portrait', className = '', label }: {
  temple: TempleKey; kind?: 'portrait' | 'icon'; className?: string; label?: string
}) {
  const art = TEMPLE_ART[temple]
  const style: CSSProperties = art.src
    ? { backgroundImage: `url('${art.src[kind]}')`, backgroundSize: kind === 'icon' ? 'contain' : 'cover', backgroundPosition: 'center' }
    : { backgroundPosition: ((art.index % 5) * 25) + '% ' + (art.index < 5 ? '0%' : '100%') }
  return <span className={'xtell-artwork xtell-artwork-' + kind + ' ' + className} style={style}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}
