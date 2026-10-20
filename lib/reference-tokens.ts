// lib/reference-tokens.ts — 圖N in a prompt, in each video model's own words
// (owner, Oct 19: "how do user reference the attached reference images? 1,
// 2, 3, 4?"). Shared by XDuel and X創作 so the two cannot drift.
//
// The user writes 圖1 / 图1 / 画像1 / 이미지1 / image 1 for the reference
// pictures in slot order. Each model gets the SAME meaning in the form its
// maker documents; where no form is confirmed, plain words in the prompt's
// own language ("第一張參考圖"), which any model reads. Read Oct 19 (no paid
// calls):
//   HappyHorse 1.0 / 1.1 R2V  "[Image 1]"  Alibaba's API reference (official)
//   Seedance 2.5              "[Image1]"   Replicate's model page (official)
//   Wan 2.7 R2V               "ImageN"     official, but the spacing is not shown → plain words
//   Wan 3.0, MiniMax H3, Gemini Omni (past one picture), Veo 3.1, Grok
//                             no confirmed form → plain words
// A confirmed form moves a model off plain words after one test call.

type Lang = 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko' | 'en'

/** 圖1, 图 2, 画像3, 이미지 1, image 2, [Image 3], 參考圖1, 参考图 2, 参考画像1, 참고 이미지 2. */
const TOKEN = /\[\s*image\s*([1-9])\s*\]|(參考圖|参考图|参考画像|참고\s?이미지|圖|图|画像|이미지)\s?([1-9])(?![0-9])|\bimage\s?([1-9])(?![0-9])/gi

const langOf = (word: string | undefined): Lang => {
  if (!word) return 'en'
  if (/圖/.test(word)) return 'zh-Hant'
  if (/图/.test(word)) return 'zh-Hans'
  if (/画像/.test(word)) return 'ja'
  if (/이미지/.test(word)) return 'ko'
  return 'en'
}

const ZH = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const KO = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉']
const EN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth']

/** "the Nth reference picture" in the language the user wrote it in. */
function plain(n: number, lang: Lang): string {
  switch (lang) {
    case 'zh-Hant': return `第${ZH[n - 1]}張參考圖`
    case 'zh-Hans': return `第${ZH[n - 1]}张参考图`
    case 'ja':      return `${n}枚目の参考画像`
    case 'ko':      return `${KO[n - 1]} 번째 참고 이미지`
    default:        return `the ${EN[n - 1]} reference image`
  }
}

type Style = 'bracket-space' | 'bracket' | 'plain'

/** How this model names its reference pictures (see the table above). */
export function refStyle(m: { provider?: string | null; model_name?: string | null }): Style {
  const name = (m.model_name ?? '').toLowerCase()
  if (/^happyhorse.*r2v/.test(name)) return 'bracket-space'
  if (name.includes('seedance')) return 'bracket'
  return 'plain'
}

/** The prompt with every 圖N (N ≤ the pictures sent) in this model's form.
 *  A number past the pictures sent is left as written. */
export function rewriteRefTokens(prompt: string, model: { provider?: string | null; model_name?: string | null }, refCount: number): string {
  if (!prompt || refCount <= 0) return prompt
  const style = refStyle(model)
  return prompt.replace(TOKEN, (whole, bracketN?: string, word?: string, wordN?: string, enN?: string) => {
    const n = Number(bracketN ?? wordN ?? enN)
    if (!n || n > refCount) return whole
    if (style === 'bracket-space') return `[Image ${n}]`
    if (style === 'bracket') return `[Image${n}]`
    return plain(n, bracketN || enN ? 'en' : langOf(word))
  })
}

/** Does the prompt name any reference picture by number? */
export const hasRefTokens = (prompt: string): boolean => new RegExp(TOKEN.source, 'i').test(prompt ?? '')
