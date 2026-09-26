// lib/xtell-history.ts — a saved visit named by what it was about. Client-
// safe. The audit (Sep 26) found every unasked visit in a list called
// 「只排了盤，還沒請老師」 and every 籤 the same: nothing said which birth,
// which stick or which hexagram. The name is built from the visit's saved
// subject, so it needs no chart and works for records saved before this.

import { PLACES } from './xtell-places'
import { castOf, hexagram, validLines } from './yijing-core'

const pad = (n: number) => String(n).padStart(2, '0')
const clip = (s: unknown, n = 24) => {
  const x = String(s ?? '').trim()
  return x.length > n ? `${x.slice(0, n)}…` : x
}
const placeOf = (k: unknown) => PLACES.find(p => p.key === k)?.label ?? ''

/** 1990-01-01 15:25, or 1990-01-01 時辰不確定: an unknown hour stays visible
 *  in the list, never a clock time. */
function born(t: (k: string) => string, b: any): string {
  if (!b || !Number.isInteger(b.y)) return ''
  return `${b.y}-${pad(b.m)}-${pad(b.d)} ${b.hourUnknown ? t('xtell.hourunknown') : `${pad(b.h)}:${pad(b.mi)}`}`
}

export function describeVisit(t: (k: string) => string, temple: string, subject: any): string {
  const s = subject ?? {}
  switch (temple) {
    case 'yuelao':
      return `${born(t, s.birth)} × ${born(t, s.birth2)}`
    case 'zhanxing':
      return [t(`xtell.astro.${s.mode ?? 'natal'}`), born(t, s.birth), s.mode === 'synastry' ? `× ${born(t, s.birth2)}` : '',
        placeOf(s.place), s.mode === 'year' && s.year ? String(s.year) : ''].filter(Boolean).join(' · ')
    case 'navagraha':
      return [born(t, s.birth), placeOf(s.place)].filter(Boolean).join(' · ')
    case 'guandi': case 'mazu':
      return [Number.isInteger(s.n) ? t('xtell.history.stick').replace('{n}', String(s.n)) : '', clip(s.ask)].filter(Boolean).join(' · ')
    case 'xingming':
      return `${s.surname ?? ''}${s.given ?? ''}`
    case 'cezi':
      return [s.ch ? `「${s.ch}」` : '', clip(s.ask)].filter(Boolean).join(' · ')
    case 'yixue': {
      try {
        if (s.mode === 'lookup' && Number.isInteger(s.n)) return `${t('xtell.yixue.mode.lookup')} · ${hexagram(s.n).name}`
        if (s.mode === 'cast' && validLines(s.lines)) {
          const c = castOf(s.lines)
          return `${t('xtell.yixue.mode.cast')} · ${c.ben.name}${c.moving.length ? ` → ${c.zhi.name}` : ''}`
        }
      } catch { /* an unreadable subject falls through to the room's name */ }
      return t('xtell.yixue.mode.ask')
    }
    default:   // 八字, 紫微, 四面佛
      return born(t, s.birth)
  }
}
