// lib/drawsomething-engine.ts
// Script-aware answer matching for Draw & Guess (owner spec, Aug 6):
// CJK languages match exact-or-alias after normalization; Japanese folds
// katakana to hiragana first (ネコ === ねこ); Latin tolerates one typo on
// longer words and ignores leading articles. Aliases ride on the term row
// (per-language spelling variants, kana readings for kanji, synonyms).

export type DrawLang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'
export const DRAW_LANGS: DrawLang[] = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']

/** Fold katakana codepoints to hiragana (U+30A1-30F6 → U+3041-3096). */
const foldKana = (s: string) =>
  s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))

/** Normalize an answer for comparison: NFKC, lowercase, strip spaces and
 *  common punctuation; per-script folding. */
export function normalizeAnswer(raw: string, lang: DrawLang): string {
  let s = String(raw ?? '').normalize('NFKC').toLowerCase().trim()
  // Strip punctuation and every kind of space — CJK answers never need
  // them and Latin comparison is done on the squeezed form too.
  s = s.replace(/[\s　]+/g, ' ').replace(/[.,!?;:'"“”‘’、。！？・〜~\-–—()（）\[\]「」『』]/g, '')
  if (lang === 'ja') s = foldKana(s)
  if (lang === 'en') {
    s = s.replace(/^(a|an|the)\s+/, '')
    s = s.replace(/\s+/g, ' ').trim()
  } else {
    s = s.replace(/\s+/g, '')
  }
  return s
}

/** Damerau-Levenshtein distance (adjacent transposition counts as ONE
 *  edit — "theif" is one typo away from "thief", which plain Levenshtein
 *  scores as two). Small-string version. */
function lev(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (m === 0 || n === 0) return Math.max(m, n)
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[m][n]
}

/** Does `guess` match `term` (or any alias) in this language? */
export function matchAnswer(guess: string, term: string, aliases: string[], lang: DrawLang): boolean {
  const g = normalizeAnswer(guess, lang)
  if (!g) return false
  const answers = [term, ...(aliases ?? [])].map(a => normalizeAnswer(a, lang)).filter(Boolean)
  for (const a of answers) {
    if (g === a) return true
    if (lang === 'en') {
      // One typo allowed on longer words; a trailing plural-s is free.
      const squeezedG = g.replace(/\s+/g, ''), squeezedA = a.replace(/\s+/g, '')
      if (squeezedA.length >= 5 && lev(squeezedG, squeezedA) <= 1) return true
      if (squeezedG === `${squeezedA}s` || `${squeezedG}s` === squeezedA) return true
    }
  }
  return false
}

/** The drawing prompt used by the offline fill tool. One template for every
 *  model so the comparison is fair; the anti-cheat line is load-bearing —
 *  a drawing with the word written on it is a dead round. */
export function drawPrompt(term: string): string {
  return [
    `A simple, clear, friendly cartoon illustration of: ${term}.`,
    'Pictionary style: ONE subject, bold clean lines, plain light background, instantly recognizable.',
    'ABSOLUTELY NO text, letters, numbers, words, captions, labels, signs or watermarks anywhere in the image.',
  ].join(' ')
}
