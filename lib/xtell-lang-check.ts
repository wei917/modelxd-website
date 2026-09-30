// lib/xtell-lang-check.ts — does a Japanese answer carry Chinese prose?
// (Sep 29: a Japanese tester saw Simplified and Traditional Chinese mixed
// into Japanese readings.) Only characters a Japanese text never uses are
// counted: simplified forms whose Japanese form differs (这 们 说 …), and
// from 繁體 only the vernacular markers (們 麼 嗎 呢 讓 裡), because a quoted
// 籤 poem is 繁體 and may hold 發, 應 or 經 legitimately. Kanji Japanese
// shares with Chinese (学, 会, 里, 現, 問 …) never count. Used to log, so
// the rate can be measured before anything retries on it.
//
// Client-safe.

const CHINESE_ONLY = new Set([...'这们说还现给为么样让应关发经实问题从动种边头两见长门开间东车书习过时对气吗呢們麼嗎讓裡'])

/** Chinese-only characters in `text`, and how many of its CJK characters they are. */
export function chineseLeak(text: string): { count: number; share: number; sample: string } {
  const cjk = [...String(text ?? '')].filter(c => /[㐀-鿿]/.test(c))
  const hits = cjk.filter(c => CHINESE_ONLY.has(c))
  return { count: hits.length, share: cjk.length ? hits.length / cjk.length : 0, sample: [...new Set(hits)].slice(0, 12).join('') }
}

/** A Japanese answer with Chinese prose in it: a few Chinese-only characters,
 *  not one stray form. */
export const leaksChinese = (text: string): boolean => chineseLeak(text).count >= 3

/** Is this text written in the page's language at all? (Sep 29: the free
 *  daily 西洋占星 reading came back wholly in literary 繁體 on a Japanese
 *  page, 「今日行運月亮位於金牛座…」, which the character list above does not
 *  catch.) Japanese always has kana, Korean hangul, English Latin letters;
 *  Chinese has none of the first two. Shares are of the letters that carry
 *  language, so numbers and punctuation do not count. */
export function inLanguage(text: string, lang: string): boolean {
  const s = String(text ?? '')
  const han = (s.match(/[㐀-鿿]/g) ?? []).length
  const kana = (s.match(/[ぁ-ゖァ-ヺー]/g) ?? []).length
  const hangul = (s.match(/[가-힣]/g) ?? []).length
  const latin = (s.match(/[A-Za-z]/g) ?? []).length
  const all = han + kana + hangul + latin
  if (all < 20) return true   // too short to judge
  if (lang === 'ja') return kana / (han + kana || 1) >= 0.2
  if (lang === 'ko') return hangul / all >= 0.4
  if (lang === 'en') return latin / all >= 0.6
  return kana + hangul === 0 || (kana + hangul) / all < 0.2   // Chinese pages
}

// ── Chinese terms in a Japanese answer, put right by code (Sep 30) ─────────
// A live re-test found the default teacher (Qwen 3.8 Flash, thinking off)
// writing 処女座, 月亮, 命主星, 大運 (in the Jyotish room), 還願 and 參宿 on
// Japanese pages although the prompt's glossary forbids each one. A rule the
// model does not keep is kept here instead: a fixed list of words, per room,
// replaced as the answer streams.
//
// Only words that cannot be part of another Japanese phrase are listed.
// 合相 is NOT (「場合相手」), nor the compass pairs (東北 is a region, and
// 「西南に利あり」 is the 易's own text), nor 事業 / 婚姻 (ordinary Japanese).
// 大運 is replaced in the Jyotish room alone, where no 四柱 大運 exists, and
// never inside 最大運勢.

type TermRule = { re: RegExp; to: string; notAfter?: string }
const term = (src: string, to: string, notAfter?: string): TermRule => ({ re: new RegExp(src, 'y'), to, notAfter })

const JA_ASTRO: TermRule[] = [
  term('処女座|處女座|室女座', '乙女座'), term('巨蟹座', '蟹座'), term('摩羯座|魔羯座', '山羊座'), term('双魚座|雙魚座', '魚座'),
  term('金牛座', '牡牛座'), term('白羊座', '牡羊座'), term('天蠍座|天蝎座', '蠍座'), term('人馬座', '射手座'),
  term('寶瓶座|宝瓶座', '水瓶座'), term('雙子座', '双子座'),
  term('月亮', '月'), term('星盤', 'ホロスコープ'), term('命主星', 'チャートルーラー'),
]
const JA_TERM_RULES: Record<string, TermRule[]> = {
  all: [term('白話訳', '現代語訳'), term('白話(?=[：:])', '現代語訳')],
  zhanxing: JA_ASTRO,
  navagraha: [
    // The gloss first, or 「大運（マハダシャ）」 would say the word twice.
    term('大運[（(]マハー?ダシャー?[)）]', 'マハーダシャー'), term('副運[（(]アンタルダシャー?[)）]', 'アンタルダシャー'),
    term('マハダシャー?|マハーダシャ(?!ー)', 'マハーダシャー'), term('アンタルダシャ(?!ー)', 'アンタルダシャー'),
    term('大運(?![勢気動営用転命行搬送賃河])', 'ダシャー', '最'), term('副運', 'アンタルダシャー'),
    ...JA_ASTRO,
  ],
  sukuyo: [term('參宿', '参宿'), term('虛宿', '虚宿')],
  simianfo: [term('還願', 'お礼参り'), term('許願', '願掛け')],
}
/** Longer than any listed word plus the one character a rule looks ahead. */
const TERM_HOLD = 16
const termRules = (room: string): TermRule[] => [...(JA_TERM_RULES[room] ?? []), ...JA_TERM_RULES.all]

/** `buf` from its start to `stop`, with every listed word replaced. A word
 *  that starts before `stop` is taken whole. `prev` is the character before
 *  `buf`, for the rules that depend on it. */
function runTerms(buf: string, rules: TermRule[], prev: string, stop: number): { out: string; at: number; prev: string } {
  let out = '', i = 0
  while (i < stop) {
    let hit = false
    for (const rule of rules) {
      if (rule.notAfter && prev && rule.notAfter.includes(prev)) continue
      rule.re.lastIndex = i
      const m = rule.re.exec(buf)
      if (!m || !m[0]) continue
      out += rule.to; i += m[0].length; prev = m[0][m[0].length - 1]; hit = true
      break
    }
    if (!hit) { out += buf[i]; prev = buf[i]; i++ }
  }
  return { out, at: i, prev }
}

/** A whole Japanese text with the room's listed words replaced. */
export function fixJaTerms(text: string, room: string): string {
  const s = String(text ?? '')
  return runTerms(s, termRules(room), '', s.length).out
}

/** The same for a stream: `push` returns what is safe to show so far (it
 *  keeps the last few characters back, in case a word is still arriving),
 *  `end` the rest. */
export function jaTermStream(room: string): { push(chunk: string): string; end(): string } {
  const rules = termRules(room)
  let buf = '', prev = ''
  return {
    push(chunk) {
      buf += chunk
      let stop = buf.length - TERM_HOLD
      if (stop <= 0) return ''
      // Never cut between the two halves of one character.
      if (/[\uD800-\uDBFF]/.test(buf[stop - 1])) stop--
      if (stop <= 0) return ''
      const r = runTerms(buf, rules, prev, stop)
      buf = buf.slice(r.at); prev = r.prev
      return r.out
    },
    end() {
      const r = runTerms(buf, rules, prev, buf.length)
      buf = ''; prev = r.prev
      return r.out
    },
  }
}
