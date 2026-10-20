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
// even at accuracy 0.1. Whisper, same TTS readings: the right passage
// 0.92-1.00, any other passage about 0.02. Whisper writes Chinese in either
// script whichever was spoken, so Chinese is compared with both.

export type PassageLang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'

// 15-20 seconds read at an easy pace. MiniMax needs at least 10 seconds of
// voice, and a TTS reading of the shorter first drafts ran 10.4-14.8 s.
export const PASSAGES: Record<PassageLang, string> = {
  'zh-Hant': '我正在建立自己的 AI 聲音。這段話由我本人親口朗讀。今天天氣很好，我想用自己的聲音說一個故事。我會用它來錄旁白、唸出我寫的文字，不會用它假冒任何人。',
  'zh-Hans': '我正在建立自己的 AI 声音。这段话由我本人亲口朗读。今天天气很好，我想用自己的声音说一个故事。我会用它来录旁白、念出我写的文字，不会用它假冒任何人。',
  ja: '私は今、自分の AI の声を作っています。この文章は私自身が声に出して読んでいます。今日はいい天気なので、自分の声で物語を語ってみたいです。ナレーションや朗読に使いますが、この声で他の人になりすますことはしません。',
  ko: '저는 지금 제 AI 목소리를 만들고 있습니다. 이 글은 제가 직접 소리 내어 읽고 있습니다. 오늘은 날씨가 좋아서, 제 목소리로 이야기를 하나 들려주고 싶습니다. 내레이션이나 낭독에 쓰겠지만, 이 목소리로 다른 사람을 사칭하지 않겠습니다.',
  en: 'I am creating my own AI voice, and I am reading these words out loud myself. The weather is nice today, so I would like to tell a short story in my own voice. I will use it for narration and reading, and I will not use it to pretend to be anyone else.',
}

export const passageLang = (v: unknown): PassageLang =>
  v === 'zh-Hant' || v === 'zh-Hans' || v === 'ja' || v === 'ko' ? v : 'en'

/** MiniMax takes 10 s to 5 min; the page stops at 30 s, which keeps a
 *  48 kHz mono WAV under 3 MB (a Vercel request body is 4.5 MB at most). */
export const MIN_SECONDS = 10
export const MAX_SECONDS = 30

/** A reading passes at this score or above (see the numbers at the top). */
export const PASS_SCORE = 0.6

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')

function bigrams(s: string): Map<string, number> {
  const g = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const k = s.slice(i, i + 2)
    g.set(k, (g.get(k) ?? 0) + 1)
  }
  return g
}

/** Dice similarity of character pairs, punctuation and spaces ignored:
 *  1 = the same words, near 0 = other words. */
function dice(a: string, b: string): number {
  const A = bigrams(norm(a)), B = bigrams(norm(b))
  let inter = 0, n = 0
  for (const [k, v] of A) { inter += Math.min(v, B.get(k) ?? 0); n += v }
  for (const v of B.values()) n += v
  return n ? (2 * inter) / n : 0
}

/** How closely a transcript matches the passage for `lang` (0-1). */
export function readingScore(transcript: string, lang: PassageLang): number {
  if (lang === 'zh-Hant' || lang === 'zh-Hans') {
    return Math.max(dice(transcript, PASSAGES['zh-Hant']), dice(transcript, PASSAGES['zh-Hans']))
  }
  return dice(transcript, PASSAGES[lang])
}
