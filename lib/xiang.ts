// lib/xiang.ts — 相學館 (面相 and 手相, owner Oct 6): the photo check, the
// 相盤 reader's instructions, and the shape of what it returns.
//
// The flow (owner, Oct 6): up to three photos (face, left palm, right palm;
// at least one), gender and the dominant hand; a cheap vision model checks
// each photo (lenient: "don't be too harsh"); a qualified vision model
// describes what it sees into the 相盤 (words, and the face's points); the
// visitor confirms or corrects it; the masters read the 相盤 as text, like
// every other temple's chart. The photos themselves are never stored: the
// browser keeps them for the drawing, the server only passes them through.
//
// Palm lines are words only. No model placed them on the creases well enough
// to draw (owner, Oct 6: "still not accurate, I would rather not showing
// those lines"; what was measured is in docs/XORACLE-PAGE.md).
//
// 看我們兩個 (owner, Oct 6, "similar to 月老"): the other person's photos
// too (a spouse, partner, someone it is ambiguous with, a crush), only with
// the visitor's word that the person in them agreed; the masters read the
// two 相盤 side by side.

import { extractJson } from './json-schema'

export type XiangPhotoKey = 'face' | 'left' | 'right'
export const PHOTO_KEYS: XiangPhotoKey[] = ['face', 'left', 'right']
export type XiangGender = 'male' | 'female'
export type XiangHand = 'right' | 'left'
export type Pt = [number, number]

/** The palm lines the reader may describe, in this order. */
export const LINE_KEYS = ['life', 'head', 'heart', 'fate', 'sun'] as const
export type LineKey = typeof LINE_KEYS[number]
/** The face marks the drawing uses: the three levels of 三停, and spots to label. */
export const MARK_KEYS = ['hairline', 'brow', 'noseBase', 'chin', 'yintang', 'leftEye', 'rightEye', 'nose', 'mouth'] as const
export type MarkKey = typeof MARK_KEYS[number]

export type Feature = { part: string; text: string }
export type FaceReading = { summary: string; features: Feature[]; marks: Partial<Record<MarkKey, Pt>>; box: [number, number, number, number] | null }
export type PalmReading = { summary: string; features: Feature[]; lines: Array<{ key: LineKey; note: string }> }
/** One person's 相盤: what each of their photos showed. */
export type XiangPerson = { face: FaceReading | null; left: PalmReading | null; right: PalmReading | null }
/** The visitor's 相盤 at the top, and the other person's when there is one. */
export type XiangChart = XiangPerson & { model: string; lang: string; partner?: XiangPerson | null }
export type XiangWho = { gender: XiangGender; dominant: XiangHand }

/** Who the other person is to the visitor (owner, Oct 6: "partner/wife/
 *  husband/girlfriend/boyfriend/your lovers/crush"). */
export const RELATIONS = ['spouse', 'dating', 'ambiguous', 'crush', 'other'] as const
export type XiangRelation = typeof RELATIONS[number]
export type XiangPartner = XiangWho & { relation: XiangRelation }
const RELATION_ZH: Record<XiangRelation, string> = {
  spouse: '配偶（夫妻）', dating: '男女朋友', ambiguous: '曖昧中，還沒確定關係',
  crush: '暗戀（對方可能還不知道來訪者的心意）', other: '其他',
}
export const asRelation = (v: unknown): XiangRelation => ((RELATIONS as readonly string[]).includes(v as string) ? (v as XiangRelation) : 'other')

// The line names the reader uses in each language (Japan's own names, owner
// Oct 6: 頭脳線, not 智慧線).
export const LINE_NAMES: Record<string, Record<LineKey, string>> = {
  'zh-Hant': { life: '生命線', head: '智慧線', heart: '感情線', fate: '事業線', sun: '太陽線' },
  'zh-Hans': { life: '生命线', head: '智慧线', heart: '感情线', fate: '事业线', sun: '太阳线' },
  ja: { life: '生命線', head: '頭脳線', heart: '感情線', fate: '運命線', sun: '太陽線' },
  ko: { life: '생명선', head: '두뇌선', heart: '감정선', fate: '운명선', sun: '태양선' },
  en: { life: 'life line', head: 'head line', heart: 'heart line', fate: 'fate line', sun: 'sun line' },
}
const LANG_NAME: Record<string, string> = { 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文', ja: '日本語', ko: '한국어', en: 'English' }
const langOf = (lang: string) => (LANG_NAME[lang] ? lang : 'zh-Hant')

// ── The quick check: one photo, a cheap model, lenient ────────────────────

// Which hand it is is not asked: the visitor knows, a phone's front camera may
// mirror the picture, and a wrong tip misleads. (The Oct 6 runs that seemed to
// show the checker mixing up hands used test photos whose left/right were
// themselves swapped: scripts/xiang-model-test.ts.)
export type PhotoCheck = { ok: boolean; is: 'face' | 'palm' | 'back' | 'other'; tip: string }

export function checkSystem(lang: string): string {
  return `你是相學館的照片檢查員。只看一張照片是不是要的那一種、能不能看清楚，不做任何解讀。
寬鬆判斷：只有完全看不出是臉或手掌、或幾乎全黑、全糊時才不通過；光線普通、角度稍斜、有點遠都算通過，最多給一句改善建議。
只輸出一個 JSON 物件，不要其他文字。tip 用${LANG_NAME[langOf(lang)]}寫，不超過 40 字；沒有建議就給空字串。`
}

/** How a palm reaches the models (Oct 9, owner: "process the palm with filters
 *  to only show clear lines… and we use those to feed into AI models"):
 *  app/components/xoracle/Xiang.tsx runs lib/palm-lines.ts on it first. */
export const PALM_AS_LINES = '手掌的圖已經處理過：只留下手的輪廓和掌紋，白底，紋路越深顏色越深，沒有膚色與背景。'

export function checkPrompt(key: XiangPhotoKey, lang: string): string {
  const want = key === 'face' ? '臉的正面照（看面相用）' : key === 'left' ? '左手的手掌（掌心朝鏡頭，看手相用）' : '右手的手掌（掌心朝鏡頭，看手相用）'
  return `這張照片應該是：${want}。${key === 'face' ? '' : `${PALM_AS_LINES}看得出是一隻手的掌心、主要掌紋看得到就通過。`}
回傳：{"ok": true 或 false, "is": "face" | "palm" | "back"（手背）| "other", "tip": "一句建議或空字串"}
不要判斷是左手還是右手（照片看不準，來訪者自己知道）。語言：${LANG_NAME[langOf(lang)]}。`
}

export function asCheck(v: unknown): PhotoCheck | null {
  if (!v || typeof v !== 'object') return null
  const o = v as any
  const is = ['face', 'palm', 'back', 'other'].includes(o.is) ? o.is : 'other'
  return { ok: o.ok !== false, is, tip: typeof o.tip === 'string' ? o.tip.trim().slice(0, 120) : '' }
}

// ── The 相盤 reader: all photos at once, a qualified vision model ─────────

export function readerSystem(lang: string): string {
  const L = langOf(lang)
  const names = LINE_NAMES[L]
  return `你是相學館的看相助手。你只負責「描述」照片裡看得到的面相與手相特徵，寫成可核對的相盤，交給相師解讀；你不解讀、不論吉凶。
規則：
1. 只寫看得到的：形狀、長短、深淺、走向、比例、清晰度、分岔與斷續。看不清楚就寫看不清楚，不要猜，不要編造照片裡沒有的東西。
2. 用中性的描述，不評美醜，不猜年齡、族群、身分或職業，不提任何健康狀況、疾病或壽命。
3. 傳統部位名稱照用（三停、印堂、山根、地閣、各掌丘等）。掌紋名稱用：${LINE_KEYS.map(k => `${k} = ${names[k]}`).join('、')}。
4. 座標只給臉：以臉的照片左上角為 (0,0)、右下角為 (1000,1000)，x 向右、y 向下，整數。掌紋不用給座標，每條看得到的紋路列一項；看不到的紋路就不要列。
   ${PALM_AS_LINES}掌丘的高低、手的顏色在這種圖上看不出來，就寫看不出來。
5. 有兩個人的照片時，分開描述每一個人，各自只看自己的照片；不比較誰好看，不評論兩人配不配。
6. 所有文字用${LANG_NAME[L]}寫。只輸出一個 JSON 物件，不要其他文字。`
}

/** The reader's request: which photo is whose, in the order they are sent
 *  (the visitor's first), and the JSON to fill. The other person's
 *  relation to the visitor is not given: the reader only describes. */
export function readerPrompt(have: XiangPhotoKey[], who: XiangWho, lang: string, partner?: XiangWho & { have: XiangPhotoKey[] }): string {
  const label: Record<XiangPhotoKey, string> = { face: '臉（正面）', left: '左手手掌', right: '右手手掌' }
  const photos = [...have.map(k => (partner ? `來訪者的${label[k]}` : label[k])), ...(partner?.have ?? []).map(k => `對方的${label[k]}`)]
  const order = photos.map((s, i) => `第 ${i + 1} 張：${s}`).join('；')
  const faceShape = `{"summary": "一句整體印象（中性描述）", "features": [{"part": "臉型", "text": "…"}, {"part": "三停", "text": "上停、中停、下停的比例"}, {"part": "額頭", "text": "…"}, {"part": "印堂", "text": "…"}, {"part": "眉", "text": "…"}, {"part": "眼", "text": "…"}, {"part": "鼻", "text": "…"}, {"part": "口", "text": "…"}, {"part": "耳", "text": "…"}, {"part": "下巴", "text": "…"}], "marks": {${MARK_KEYS.map(k => `"${k}": [x, y]`).join(', ')}}, "box": [左, 上, 右, 下]}`
  const palmShape = `{"summary": "一句整體印象", "features": [{"part": "手型", "text": "掌形與手指"}, {"part": "生命線", "text": "…"}, …每條看得到的紋路一項, {"part": "掌丘", "text": "…"}], "lines": [{"key": "life", "note": "這條紋路的一句描述"}, …]}`
  const person = (h: XiangPhotoKey[]) => `"face": ${h.includes('face') ? faceShape : 'null'}, "left": ${h.includes('left') ? palmShape : 'null'}, "right": ${h.includes('right') ? palmShape : 'null'}`
  const sex = (w: XiangWho) => `${w.gender === 'female' ? '女' : '男'}，慣用手是${w.dominant === 'left' ? '左手' : '右手'}`
  return `照片順序：${order}。
來訪者：${sex(who)}。${partner ? `\n對方：${sex(partner)}。` : ''}
marks 的意思：hairline 髮際中點、brow 兩眉之間的眉線、noseBase 鼻底（人中上端）、chin 下巴最低點、yintang 印堂、leftEye/rightEye 照片中左邊與右邊那隻眼睛的中心、nose 鼻頭、mouth 嘴的中心；box 是整張臉的範圍。${partner ? '每張臉的座標各自以那張照片為準。' : ''}
回傳 JSON：{${person(have)}${partner ? `, "partner": {${person(partner.have)}}` : ''}}
${partner ? '來訪者的寫在最外層，對方的寫在 partner 裡。' : ''}沒有提供的照片填 null。所有文字用${LANG_NAME[langOf(lang)]}。`
}

/** The model's reply as an object (tolerant of fences and prose around it). */
export function parseJson(text: string): any | null {
  const v = extractJson(text)
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const coord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1000, Math.round(v))) : null)
function pt(v: unknown): Pt | null {
  if (!Array.isArray(v) || v.length < 2) return null
  const x = coord(v[0]), y = coord(v[1])
  return x === null || y === null ? null : [x, y]
}
function features(v: unknown): Feature[] {
  if (!Array.isArray(v)) return []
  return v.map(f => ({ part: str((f as any)?.part, 16), text: str((f as any)?.text, 240) })).filter(f => f.part && f.text).slice(0, 14)
}

/** One person's photos as the reader described them, bounded: the reply is
 *  a model's, so every string is cut and every point clamped to the photo. */
function personOf(raw: any, have: XiangPhotoKey[]): XiangPerson {
  const src = raw && typeof raw === 'object' ? raw : {}
  const face = (() => {
    const f = have.includes('face') ? src.face : null
    if (!f || typeof f !== 'object') return null
    const marks: Partial<Record<MarkKey, Pt>> = {}
    for (const k of MARK_KEYS) { const p = pt(f.marks?.[k]); if (p) marks[k] = p }
    const b = Array.isArray(f.box) && f.box.length === 4 ? f.box.map(coord) : null
    const box = b && b.every((n: number | null) => n !== null) && b[2] > b[0] && b[3] > b[1] ? (b as [number, number, number, number]) : null
    const out: FaceReading = { summary: str(f.summary, 200), features: features(f.features), marks, box }
    return out.features.length || out.summary ? out : null
  })()
  // Palm lines are words only: any points the reader sends anyway are dropped.
  const palm = (key: 'left' | 'right'): PalmReading | null => {
    const p = have.includes(key) ? src[key] : null
    if (!p || typeof p !== 'object') return null
    const seen = new Set<string>()
    const lines = (Array.isArray(p.lines) ? p.lines : [])
      .map((l: any) => ({ key: l?.key, note: str(l?.note, 120) }))
      .filter((l: any) => (LINE_KEYS as readonly string[]).includes(l.key) && !seen.has(l.key) && seen.add(l.key))
    const out: PalmReading = { summary: str(p.summary, 200), features: features(p.features), lines }
    return out.features.length || out.summary ? out : null
  }
  return { face, left: palm('left'), right: palm('right') }
}
const empty = (p: XiangPerson) => !p.face && !p.left && !p.right

/** Only what the drawing and the masters can use. A two-person reading
 *  needs something of both people, or it is no reading. */
export function cleanChart(raw: any, have: XiangPhotoKey[], model: string, lang: string, partnerHave: XiangPhotoKey[] = []): XiangChart | null {
  if (!raw || typeof raw !== 'object') return null
  const me = personOf(raw, have)
  if (empty(me)) return null
  const partner = partnerHave.length ? personOf(raw.partner, partnerHave) : null
  if (partner && empty(partner)) return null
  return { ...me, model, lang: langOf(lang), ...(partner ? { partner } : {}) }
}

/** The visitor's details plus the 相盤 as the masters read it. The words
 *  are the reader's, in the visitor's language; the visitor's own
 *  corrections follow and outrank it. */
export function xiangFacts(chart: XiangChart, who: XiangWho, note: string, partner?: XiangPartner | null): string {
  const names = LINE_NAMES[chart.lang] ?? LINE_NAMES['zh-Hant']
  const block = (title: string, r: { summary: string; features: Feature[] }) =>
    [`【${title}】${r.summary ? r.summary : ''}`, ...r.features.map(f => `- ${f.part}：${f.text}`)].join('\n')
  const person = (p: XiangPerson, prefix: string, whose: string) => {
    const out: string[] = []
    if (p.face) out.push(block(`${prefix}面相`, p.face))
    for (const key of ['left', 'right'] as const) {
      const r = p[key]
      if (!r) continue
      const listed = r.lines.map(l => `${names[l.key]}${l.note ? `（${l.note}）` : ''}`).join('、')
      out.push(block(`${prefix}${key === 'left' ? '左手' : '右手'}`, r) + (listed ? `\n- 看得到的紋路：${listed}` : ''))
    }
    const missing = (['face', 'left', 'right'] as const).filter(k => !p[k]).map(k => (k === 'face' ? '臉' : k === 'left' ? '左手' : '右手'))
    if (missing.length) out.push(`${whose}沒有提供：${missing.join('、')}（不要談這些部分）。`)
    return out
  }
  const sex = (w: XiangWho) => `${w.gender === 'female' ? '女' : '男'}；慣用手：${w.dominant === 'left' ? '左手' : '右手'}`
  const parts: string[] = [`來訪者：${sex(who)}。`, ...person(chart, '', '')]
  if (chart.partner && partner) {
    parts.push(`對方（與來訪者的關係：${RELATION_ZH[partner.relation]}）：${sex(partner)}。照片是來訪者在對方同意下提供的。`)
    parts.push(...person(chart.partner, '對方的', '對方'))
  }
  if (note.trim()) parts.push(`來訪者對相盤的補充或更正（以此為準）：${note.trim()}`)
  return parts.join('\n\n')
}

export const NOTE_MAX = 400

/** A photo on its way to the models (server side; never stored). */
export type Photo = { key: XiangPhotoKey; buffer: Buffer; mediaType: string; who: 'me' | 'partner' }

/** The browser sends each photo as a data URL, already shrunk to 1280 px
 *  (app/components/xoracle/Xiang.tsx). Anything else is refused whole. */
export const PHOTO_MAX_BYTES = 2_500_000
export function photosOf(v: unknown, who: 'me' | 'partner' = 'me'): Photo[] | 'invalid' {
  if (!v || typeof v !== 'object') return []
  const out: Photo[] = []
  for (const key of PHOTO_KEYS) {
    const s = (v as any)[key]
    if (s == null || s === '') continue
    const m = typeof s === 'string' ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s) : null
    if (!m) return 'invalid'
    const buffer = Buffer.from(m[2], 'base64')
    if (buffer.length < 2_000 || buffer.length > PHOTO_MAX_BYTES) return 'invalid'
    out.push({ key, buffer, mediaType: m[1], who })
  }
  return out
}
export const asGender = (v: unknown): XiangGender => (v === 'female' ? 'female' : 'male')
export const asHand = (v: unknown): XiangHand => (v === 'left' ? 'left' : 'right')
