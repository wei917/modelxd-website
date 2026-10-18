// lib/caption-text.ts: words burned into a video (the 風扇變裝 template's
// captions, 同款's on-screen text), in a font that has every letter, at a
// size and with line breaks that fit the frame.
//
// ffmpeg's drawtext has no font fallback: a letter its font lacks is a box.
// XCut's Noto Sans TC (public/fonts) has no Hangul, no simplified-only
// characters (们, 这) and no Japanese forms (毎, 黒), so 毎日コーデ came out
// as ☒日コーデ (Oct 18). fonts/ holds Noto Sans TC, SC, JP and KR; a line is
// drawn in the first of them, in its language's order, that has all its
// letters. Letters none has (emoji) are left out instead of drawn as boxes.
//
// drawtext (ffmpeg 6.0) draws a line at one size and cannot align lines, so a
// long caption is broken into two or three balanced lines at the largest size
// that fits, each line its own filter on a baseline (y = baseline - ascent).

import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'

type Key = 'tc' | 'sc' | 'jp' | 'kr'
const DIR = path.join(process.cwd(), 'fonts')
const FILES: Record<Key, string> = { tc: 'NotoSansTC-Regular.ttf', sc: 'NotoSansSC-Regular.otf', jp: 'NotoSansJP-Regular.otf', kr: 'NotoSansKR-Regular.otf' }
const ORDER: Record<string, Key[]> = { 'zh-Hans': ['sc', 'tc', 'jp', 'kr'], ja: ['jp', 'tc', 'sc', 'kr'], ko: ['kr', 'tc', 'jp', 'sc'] }
const DEFAULT_ORDER: Key[] = ['tc', 'sc', 'jp', 'kr']
// Kana or Hangul in the words picks that script's font first, whatever the
// page's language (a Japanese outfit typed on the Chinese page).
const KANA = /[\u3041-\u3096\u30a1-\u30fa\u31f0-\u31ff\uff66-\uff9d]/
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/
// Joiners and variation selectors draw nothing, or a box: never drawn.
const SILENT = /[\u0000-\u001f\u007f\u200b-\u200f\u2060\ufe00-\ufe0f]/
// Where a line may not break: before closing marks and small kana, after
// opening marks, or inside a word of Latin letters, digits or Hangul (Korean
// breaks at spaces). Japanese keeps a katakana word, a kanji compound and
// the kana after it whole (ベージュの | ロングスカート); Chinese may break
// between any two characters.
const NO_START = new Set(Array.from('、。，．,.・：:；;！!？?）)」』】〉》〕］]｝}ー〜～…‥%％ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ'))
const NO_END = new Set(Array.from('（(「『【〈《〔［[｛{'))
const WORD = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Hangul}\p{Nd}'’&-]/u
const KATAKANA = /[\p{Script=Katakana}ー]/u
const HIRAGANA = /\p{Script=Hiragana}/u
const HAN = /\p{Script=Han}/u
// A break here reads better: at a space or after a comma or stop.
const CLAUSE_END = /[，、。,;；：:！!？?）)」』]$/

type Face = { file: string; glyph: (cp: number) => number; advance: (gid: number) => number; upm: number }
const faces = new Map<Key, Face>()

function face(key: Key): Face {
  let f = faces.get(key)
  if (!f) { f = readFace(path.join(DIR, FILES[key])); faces.set(key, f) }
  return f
}

/** The few tables a width needs: cmap (letter to glyph; format 12 covers
 *  every plane, format 4 the BMP), hmtx (glyph to advance), head (units). */
function readFace(file: string): Face {
  const b = readFileSync(file)
  const at: Record<string, number> = {}
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) { const r = 12 + i * 16; at[b.toString('latin1', r, r + 4)] = b.readUInt32BE(r + 8) }
  const upm = b.readUInt16BE(at.head + 18)
  const metrics = b.readUInt16BE(at.hhea + 34)
  const advance = (gid: number) => b.readUInt16BE(at.hmtx + 4 * Math.min(gid, metrics - 1))
  let f12 = -1, f4 = -1
  for (let i = 0, n = b.readUInt16BE(at.cmap + 2); i < n; i++) {
    const r = at.cmap + 4 + i * 8
    const platform = b.readUInt16BE(r), encoding = b.readUInt16BE(r + 2), sub = at.cmap + b.readUInt32BE(r + 4)
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue
    const format = b.readUInt16BE(sub)
    if (format === 12) f12 = sub
    else if (format === 4) f4 = sub
  }
  let glyph = (_cp: number) => 0
  if (f12 >= 0) {
    const groups = b.readUInt32BE(f12 + 12)
    glyph = cp => {
      let lo = 0, hi = groups - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1, r = f12 + 16 + mid * 12
        if (cp < b.readUInt32BE(r)) hi = mid - 1
        else if (cp > b.readUInt32BE(r + 4)) lo = mid + 1
        else return b.readUInt32BE(r + 8) + cp - b.readUInt32BE(r)
      }
      return 0
    }
  } else if (f4 >= 0) {
    const seg = b.readUInt16BE(f4 + 6) / 2
    const ends = f4 + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2
    glyph = cp => {
      if (cp > 0xffff) return 0
      let lo = 0, hi = seg - 1
      while (lo < hi) { const mid = (lo + hi) >> 1; if (b.readUInt16BE(ends + mid * 2) < cp) lo = mid + 1; else hi = mid }
      const start = b.readUInt16BE(starts + lo * 2)
      if (cp < start || cp > b.readUInt16BE(ends + lo * 2)) return 0
      const delta = b.readUInt16BE(deltas + lo * 2), range = b.readUInt16BE(ranges + lo * 2)
      if (!range) return (cp + delta) & 0xffff
      const g = b.readUInt16BE(ranges + lo * 2 + range + (cp - start) * 2)
      return g ? (g + delta) & 0xffff : 0
    }
  }
  return { file, glyph, advance, upm }
}

const has = (f: Face, ch: string) => ch === ' ' || f.glyph(ch.codePointAt(0)!) > 0
const em = (f: Face, s: string) => Array.from(s).reduce((w, ch) => w + f.advance(f.glyph(ch.codePointAt(0)!)), 0) / f.upm

/** The font for these words: the first, in the language's order, that has
 *  every letter; else the one that has the most, with the rest left out. */
function pick(text: string, lang?: string): { f: Face; text: string } {
  const letters = Array.from(text).filter(ch => !SILENT.test(ch))
  const base = ORDER[lang ?? ''] ?? DEFAULT_ORDER
  const first: Key | null = HANGUL.test(text) ? 'kr' : KANA.test(text) ? 'jp' : null
  let best: { f: Face; n: number } | null = null
  for (const key of first ? [first, ...base.filter(k => k !== first)] : base) {
    const f = face(key)
    const n = letters.filter(ch => has(f, ch)).length
    if (n === letters.length) return { f, text: letters.join('') }
    if (!best || n > best.n) best = { f, n }
  }
  const f = best!.f
  return { f, text: letters.filter(ch => has(f, ch)).join('').replace(/ {2,}/g, ' ').trim() }
}

/** The words as units a line may break between ('' marks a space). */
function units(s: string): string[] {
  const japanese = KANA.test(s)
  const out: string[] = []
  for (const ch of Array.from(s)) {
    if (ch === ' ') { if (out.length && out[out.length - 1] !== '') out.push(''); continue }
    const prev = out.length ? out[out.length - 1] : ''
    const last = prev ? Array.from(prev).pop()! : ''
    const glue = NO_START.has(ch) || NO_END.has(last) || (WORD.test(ch) && WORD.test(last)) ||
      (japanese && ((KATAKANA.test(ch) && KATAKANA.test(last)) || (HAN.test(ch) && HAN.test(last)) ||
        (HIRAGANA.test(ch) && (HAN.test(last) || KATAKANA.test(last) || HIRAGANA.test(last)))))
    if (prev && glue) out[out.length - 1] += ch
    else out.push(ch)
  }
  return out
}

const joined = (us: string[]) => us.map(u => u || ' ').join('').trim()

/** Two lines: the break that allows the largest size up to `size`, except
 *  that a break at a space or after a comma wins when its size is within 15%
 *  of that; ties go to the evener pair. */
function two(f: Face, us: string[], room: number, size: number): { lines: string[]; em: number } | null {
  const all: { lines: string[]; em: number; s: number; nice: boolean; diff: number }[] = []
  for (let i = 1; i < us.length; i++) {
    const a = joined(us.slice(0, i)), b = joined(us.slice(i))
    if (!a || !b) continue
    const wa = em(f, a), wb = em(f, b), w = Math.max(wa, wb)
    all.push({ lines: [a, b], em: w, s: Math.min(size, Math.floor(room / w)), nice: us[i] === '' || us[i - 1] === '' || CLAUSE_END.test(a), diff: Math.abs(wa - wb) })
  }
  if (!all.length) return null
  const top = Math.max(...all.map(c => c.s))
  const nice = all.filter(c => c.nice && c.s >= top * 0.85)
  return (nice.length ? nice : all.filter(c => c.s === top)).reduce((x, y) => y.s > x.s || (y.s === x.s && y.diff < x.diff) ? y : x)
}

/** Lines no wider than `limit` em, filled greedily. */
function fill(f: Face, us: string[], limit: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const u of us) {
    if (u === '') { if (line) line += ' '; continue }
    if (line && em(f, (line + u).trimEnd()) > limit) { lines.push(line.trimEnd()); line = u }
    else line += u
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines
}

/** At most `n` lines, as even as the breaks allow: the narrowest limit that
 *  still fills into n lines. */
function balance(f: Face, us: string[], n: number): { lines: string[]; em: number } {
  let lo = Math.max(...us.filter(Boolean).map(u => em(f, u))), hi = em(f, joined(us))
  let lines = fill(f, us, hi)
  for (let i = 0; i < 20 && hi - lo > 0.05; i++) {
    const mid = (lo + hi) / 2
    const next = fill(f, us, mid)
    if (next.length <= n) { hi = mid; lines = next } else lo = mid
  }
  return { lines, em: Math.max(...lines.map(l => em(f, l))) }
}

export type Caption = { font: string; size: number; lines: string[] }

/** The font, size and lines for one caption `width` px wide: one line when
 *  it fits at 80% of `size` or more, else two (or three) balanced lines at
 *  the largest size up to `size`, three only when two stay under `min`. */
export function fitCaption(text: string, lang: string | undefined, width: number, size: number, min: number): Caption | null {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const { f, text: words } = pick(clean, lang)
  if (!words) return null
  // drawtext's hinted advances run a little wider than the font's own.
  const room = width * 0.96
  let best = { lines: [words], size: Math.min(size, Math.floor(room / em(f, words))) }
  if (best.size < size * 0.8) {
    const us = units(words)
    for (const n of [2, 3]) {
      const b = n === 2 ? two(f, us, room, size) : balance(f, us, n)
      if (!b) continue
      const s = Math.min(size, Math.floor(room / b.em))
      if (s > best.size) best = { lines: b.lines, size: s }
      if (best.size >= min) break
    }
  }
  return { font: f.file, size: Math.max(1, best.size), lines: best.lines }
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, '\u2019').replace(/:/g, '\\:').replace(/%/g, '\\%')

/** drawtext filters for a caption, centred: `y` is the first line's
 *  baseline when `anchor` is 'top', the last line's when 'bottom'. The words
 *  go through files (nothing to escape) with expansion off (a typed % stays
 *  a %). `style` ends every filter (colours, border, enable). */
export async function captionFilters(c: Caption, dir: string, name: string, y: number, anchor: 'top' | 'bottom', style: string): Promise<string[]> {
  const lead = Math.round(c.size * 1.25)
  const out: string[] = []
  for (const [i, line] of c.lines.entries()) {
    const file = path.join(dir, `${name}-${i}.txt`)
    await fs.writeFile(file, line)
    const base = Math.round(anchor === 'top' ? y + i * lead : y - (c.lines.length - 1 - i) * lead)
    out.push(`drawtext=fontfile='${esc(c.font)}':textfile='${esc(file)}':expansion=none:fontsize=${c.size}:x=(w-tw)/2:y=${base}-ascent:${style}`)
  }
  return out
}
