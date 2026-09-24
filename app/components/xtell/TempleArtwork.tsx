import type { CSSProperties } from 'react'

export type TempleKey = 'bazi' | 'ziwei' | 'yuelao' | 'guandi' | 'mazu' | 'simianfo' | 'navagraha' | 'zhanxing' | 'xingming' | 'cezi'
// Menu order (owner, Sep 24: 有技術的放前面): the computed methods first —
// 八字, 紫微, 西洋占星, 吠陀占星, 姓名, 測字 — then the deity rooms. The art
// sheets keep their own five-by-two order via TEMPLE_ART below, so this list
// is display order only.
export const DISPLAY_TEMPLES: TempleKey[] = ['bazi', 'ziwei', 'zhanxing', 'navagraha', 'xingming', 'cezi', 'yuelao', 'guandi', 'mazu', 'simianfo']

// Both approved image sheets use the same five-column, two-row ordering.
export const TEMPLE_ART: Record<TempleKey, { index: number; caption: string }> = {
  mazu: { index: 0, caption: 'MAZU' }, guandi: { index: 1, caption: 'GUAN DI' },
  yuelao: { index: 2, caption: 'YUE LAO' }, simianfo: { index: 3, caption: 'BRAHMA' },
  navagraha: { index: 4, caption: 'NAVAGRAHA' }, bazi: { index: 5, caption: 'FOUR PILLARS' },
  ziwei: { index: 6, caption: 'ZI WEI DOU SHU' }, xingming: { index: 7, caption: 'NAME STUDY' },
  cezi: { index: 8, caption: 'CHARACTER READING' }, zhanxing: { index: 9, caption: 'ASTROLOGY' },
}

export function TempleArtwork({ temple, kind = 'portrait', className = '', label }: {
  temple: TempleKey; kind?: 'portrait' | 'icon'; className?: string; label?: string
}) {
  const { index } = TEMPLE_ART[temple]
  const style: CSSProperties = { backgroundPosition: ((index % 5) * 25) + '% ' + (index < 5 ? '0%' : '100%') }
  return <span className={'xtell-artwork xtell-artwork-' + kind + ' ' + className} style={style}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}
