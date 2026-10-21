// lib/voice-passages.ts — what a person reads aloud to clone their voice in
// X創作's 語音 (owner, Oct 20: "clone voice and ask the ai to speak some text
// with cloned voice"), and how the server checks they read it.
//
// Own voice only. The page shows one passage in the page's language; the
// server transcribes the recording with Whisper and compares it with the
// SAME passage held here, so a clip of somebody else (an interview, a
// video) cannot pass: they never said these words. Shared by the page and
// the route; client-safe.
//
// Why Whisper and not MiniMax's own check (`text_validation`): probed Oct
// 20, MiniMax's passes the right passage and refuses a wrong one in 繁中,
// 简中 and English, but refuses the RIGHT passage in Japanese and Korean
// even at accuracy 0.1. Whisper writes Chinese in either script whichever
// was spoken, so Chinese is compared with both.

export type PassageLang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'

// Two sentences, about 8-10 seconds read (owner, Oct 20: "the passage on
// screen is long"; the first ones ran 15-20 s). MiniMax needs a 10-second
// recording, so the page fills a shorter one out with quiet
// (lib/audio-normalize.ts `minSeconds`); probed Oct 20: 8.0-9.8 s of reading
// padded to 10.5 s cloned fine in 繁中, Japanese and English.
export const PASSAGES: Record<PassageLang, string> = {
  'zh-Hant': '這是我本人的聲音，由我親口朗讀。我會用它說故事、錄旁白，不會用它假冒任何人。',
  'zh-Hans': '这是我本人的声音，由我亲口朗读。我会用它说故事、录旁白，不会用它假冒任何人。',
  ja: 'これは私自身の声で、私が読み上げています。物語やナレーションに使い、他の人になりすますことはしません。',
  ko: '이것은 제 목소리이고, 제가 직접 읽고 있습니다. 이야기나 내레이션에 쓰고, 다른 사람을 사칭하지 않겠습니다.',
  en: 'This is my own voice, and I am reading it myself. I will use it for stories and narration, never to pretend to be someone else.',
}

export const passageLang = (v: unknown): PassageLang =>
  v === 'zh-Hant' || v === 'zh-Hans' || v === 'ja' || v === 'ko' ? v : 'en'

/** MiniMax takes 10 s to 5 min: the page pads a shorter recording to
 *  MIN_SECONDS, refuses one under MIN_SPOKEN (a slip of the finger), and
 *  stops at 30 s, which keeps a 48 kHz mono WAV under 3 MB (a Vercel
 *  request body is 4.5 MB at most). */
export const MIN_SECONDS = 10
export const MIN_SPOKEN = 5
export const MAX_SECONDS = 30

/** A reading passes at this score or above (see the numbers at the top). */
export const PASS_SCORE = 0.6

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
const words = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').split(/\s+/).filter(Boolean)

/** Pairs of neighbours: characters for Chinese, Japanese and Korean, WORDS
 *  for English, where any two sentences share common letter pairs (other
 *  English speech scored 0.36 by letters against a 0.6 bar). */
function bigrams(items: string[]): Map<string, number> {
  const g = new Map<string, number>()
  for (let i = 0; i < items.length - 1; i++) {
    const k = items[i] + '\u0000' + items[i + 1]
    g.set(k, (g.get(k) ?? 0) + 1)
  }
  return g
}
const units = (s: string, lang: PassageLang) => lang === 'en' ? words(s) : [...norm(s)]

/** Dice similarity of neighbour pairs, punctuation and spaces ignored:
 *  1 = the same words, near 0 = other words. */
function dice(a: string, b: string, lang: PassageLang): number {
  const A = bigrams(units(a, lang)), B = bigrams(units(b, lang))
  let inter = 0, n = 0
  for (const [k, v] of A) { inter += Math.min(v, B.get(k) ?? 0); n += v }
  for (const v of B.values()) n += v
  return n ? (2 * inter) / n : 0
}

/** How closely a transcript matches the passage for `lang` (0-1). */
export function readingScore(transcript: string, lang: PassageLang): number {
  if (lang === 'zh-Hant' || lang === 'zh-Hans') {
    return Math.max(dice(transcript, PASSAGES['zh-Hant'], lang), dice(transcript, PASSAGES['zh-Hans'], lang))
  }
  return dice(transcript, PASSAGES[lang], lang)
}
