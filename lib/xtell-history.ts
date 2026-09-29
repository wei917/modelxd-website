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
    case 'kyusei':
      return born(t, s.birth)
    case 'cookie':
      return clip(String(s.food ?? '').replace(/\s+/g, ' '))
    case 'tarot':
      return [s.spread === 'three' ? t('xtell.tarot.spread.three') : t('xtell.tarot.spread.one'), clip(s.ask)].filter(Boolean).join(' · ')
    case 'guandi': case 'mazu': case 'guanyin':
      return [Number.isInteger(s.n) ? t('xtell.history.stick').replace('{n}', String(s.n)) : '', clip(s.ask)].filter(Boolean).join(' · ')
    case 'xingming':
      return `${s.surname ?? ''}${s.given ?? ''}`
    case 'cezi':
      return [s.ch ? `「${s.ch}」` : '', clip(s.ask)].filter(Boolean).join(' · ')
    case 'jiemeng':
      return clip(String(s.dream ?? '').replace(/\s+/g, ' '))
    case 'daily':
      return [typeof s.date === 'string' ? s.date : '', s.method === 'western' || s.method === 'bazi' ? t(`xtell.dy.${s.method}`) : ''].filter(Boolean).join(' · ')
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

/**
 * What a visit with no question yet is called, in the words of its own
 * workflow (tester, Sep 26: 「只排了盤」 on a 籤 or on 四面佛's wishes is
 * not what happened). Only the chart temples 排盤.
 */
export function notAskedKey(temple: string): string {
  switch (temple) {
    case 'guandi': case 'mazu': case 'guanyin': return 'xtell.saved.notasked.qian'
    case 'tarot': return 'xtell.saved.notasked.tarot'
    case 'kyusei': return 'xtell.saved.notasked.kyusei'
    case 'cookie': return 'xtell.saved.notasked.cookie'
    case 'simianfo': return 'xtell.saved.notasked.wish'
    case 'xingming': return 'xtell.saved.notasked.name'
    case 'cezi': return 'xtell.saved.notasked.char'
    case 'jiemeng': return 'xtell.saved.notasked.dream'
    case 'yixue': return 'xtell.saved.chartonly.yixue'
    default: return 'xtell.saved.chartonly'   // 八字, 紫微, 月老, 九曜, 占星
  }
}

/**
 * Erase a saved visit for good (owner, Sep 26: deleting means deleting; the
 * lists used to set `deleted_at` and keep the row). The owner-delete policy
 * of supabase/105 scopes it to the signed-in user's own rows. The deleted id
 * is read back, so a delete that matched nothing (another user's row, one
 * already gone, a missing policy) is reported as a failure, never shown as
 * done. Account deletion still erases every row by cascade.
 */
export async function eraseReading(sb: any, id: string): Promise<boolean> {
  const { data, error } = await sb.from('xtell_readings').delete().eq('id', id).select('id')
  return !error && Array.isArray(data) && data.length === 1
}

// ── Renaming a visit (owner, Sep 28) ─────────────────────────────────────────
// A visit is titled automatically (its first question, cut at 80 characters by
// xtell_append_turns, or what the room titles it by). The visitor may give it
// their own name, at most TITLE_MAX characters, the same limit as the
// automatic one; an empty name goes back to the automatic title. A later
// question never overwrites a chosen name (the append keeps a title it finds).

export const TITLE_MAX = 80

/** The name as it will be kept: whitespace folded, cut to TITLE_MAX; empty is null. */
export function cleanTitle(s: unknown): string | null {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t ? [...t].slice(0, TITLE_MAX).join('') : null
}

/** The automatic title a cleared name goes back to: the first question asked. */
export function firstAsk(turns: unknown): string | null {
  const u = Array.isArray(turns) ? turns.find((x: any) => x?.role === 'user' && typeof x.content === 'string' && x.content.trim()) : null
  return u ? [...String((u as any).content).trim()].slice(0, TITLE_MAX).join('') : null
}

/** Rename a visit through the visitor's own session (the owner-update policy
 *  of supabase/105). Read back, so a rename that matched nothing is a failure. */
export async function renameReading(sb: any, id: string, title: string | null): Promise<boolean> {
  const { data, error } = await sb.from('xtell_readings').update({ title: cleanTitle(title) }).eq('id', id).select('id')
  return !error && Array.isArray(data) && data.length === 1
}
