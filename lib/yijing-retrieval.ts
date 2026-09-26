// lib/yijing-retrieval.ts — 易學堂's bounded retrieval. Pure: no file system,
// no model. lib/yijing.ts builds the units from the corpus on disk and says
// what they are; lib/classics.ts uses the same folding to score the 十翼.
//
// Two small indexes, both auditable by eye:
//   PHRASES  — a run of ≥4 characters in the question that occurs verbatim in
//              the 經 or 傳. The corpus is the index; nothing is curated. A
//              phrase found in several places is reported with every place,
//              never credited to one hexagram.
//   CONCEPTS — three topics (進退與工作, 合作與分歧, 陰陽與八卦), each a keyword list
//              in the site's five languages and a few exact quotations. They
//              are reading material and analogies, never a cast.
//
// Folding (Japanese forms → traditional → the corpus's own simplified pairs)
// is for MATCHING only. Everything shown to the teacher is corpus text.

/** Two-character string "ab cd …" → Map a→b. */
function pairs(s: string): Map<string, string> {
  const m = new Map<string, string>()
  const cs = [...s]
  for (let i = 0; i + 1 < cs.length; i += 2) m.set(cs[i], cs[i + 1])
  return m
}

// Japanese forms whose traditional form occurs in the corpus, plus the
// variants 爲 and 説. Forms that are also ordinary Chinese characters with
// another meaning (予 余 台 芸 証 欠 …) are left out on purpose.
const J2T = pairs('悪惡囲圍隠隱栄榮営營円圓応應仮假画畫会會懐懷学學楽樂巻卷陥陷勧勸寛寬観觀関關顔顏気氣帰歸亀龜犠犧旧舊拠據挙舉駆驅径徑恵惠渓溪経經軽輕継繼撃擊県縣倹儉険險権權顕顯厳嚴広廣効效号號済濟雑雜参參賛贊児兒辞辭湿濕実實収收従從獣獸処處将將称稱乗乘縄繩触觸尽盡図圖粋粹随隨枢樞数數静靜斉齊専專戦戰壮壯巣巢蔵藏属屬続續対對帯帶沢澤断斷遅遲昼晝聴聽伝傳当當盗盜徳德独獨弐貳廃廢発發髪髮抜拔払拂変變宝寶豊豐没沒満滿黙默薬藥与與誉譽来來乱亂竜龍両兩礼禮霊靈歴歷労勞説說爲為虚虛勅敕歳歲')

// Traditional → simplified for the corpus's own characters: Wikisource's
// zh-hans converter on the 1,370 distinct characters of content/yijing and
// content/classics/zhouyi-* (Sep 26), with two edits: 乾 stays 乾 (simplified
// text keeps it for the hexagram) and 餘 → 余 (the converter gave 馀).
const T2S = pairs('並并亂乱來来係系偽伪備备傳传傷伤傾倾僕仆儀仪億亿儉俭兌兑內内兩两冑胄則则剛刚剝剥動动務务勝胜勞劳勢势勸劝厭厌厲厉參参叢丛問问啞哑喪丧嗇啬嘗尝嚮向嚴严國国圍围園园圓圆圖图執执堅坚堯尧報报塗涂壯壮奪夺奮奋婦妇學学宮宫實实寧宁寬宽寵宠寶宝將将專专對对屢屡屨屦屬属帥帅師师帶带幹干幾几庫库廟庙廢废廣广廬庐弒弑張张強强彌弥彙汇後后徑径從从復复恆恒恥耻悶闷惡恶惻恻愛爱慍愠慚惭慮虑慶庆憂忧憊惫應应懲惩懷怀懼惧戔戋戰战戶户掛挂揚扬揮挥損损撝㧑擊击據据擬拟攣挛敗败敵敌數数斷断於于時时晉晋晝昼暉晖暢畅書书會会東东棄弃棟栋楊杨業业極极榮荣構构槨椁樂乐樞枢樹树橈桡機机權权歲岁歷历歸归殺杀毀毁氣气決决沒没況况淵渊渙涣測测湯汤準准溝沟滅灭滿满漁渔漣涟漸渐潔洁潛潜潤润澤泽濕湿濟济瀆渎災灾為为無无營营爛烂爾尔牀床牽牵犧牺狀状猶犹獄狱獨独獲获獸兽瑣琐畢毕畫画異异當当疇畴發发盜盗盡尽眾众矯矫碩硕確确祿禄禦御禮礼稱称穀谷積积穫获窮穷窺窥竄窜節节範范篤笃簡简紂纣約约納纳純纯紛纷紱绂終终結结絕绝絪𬘡統统經经綜综維维綸纶緩缓縕缊縣县繩绳繫系繻𦈡繼继纆𬙊續续罰罚罷罢羣群義义習习聖圣聞闻聰聪聲声聽听脩修膚肤臘腊臨临與与興兴舉举舊旧艱艰茲兹莧苋華华萬万葦苇蒞莅蒼苍蓋盖蕩荡薦荐藥药蘇苏蘭兰處处虛虚號号虧亏蟄蛰蠱蛊衆众術术衛卫補补見见視视覩睹親亲覿觌觀观觸触訟讼設设試试詳详誅诛語语誠诚誡诫誣诬誥诰誨诲說说誰谁諂谄諸诸謀谋謂谓謙谦講讲謹谨識识議议譽誉變变豐丰豶豮貝贝貞贞負负財财貢贡貨货貫贯貳贰貴贵賁贲資资賓宾賞赏賢贤賤贱質质賾赜贊赞躋跻躍跃車车載载輔辅輕轻輝辉輪轮輮𫐓輻辐輿舆辭辞辯辩農农連连進进遊游運运過过違违遠远適适遯遁遲迟遷迁遺遗邇迩鄰邻醜丑鉉铉鉤钩錫锡錯错長长門门閉闭開开閏闰閑闲間间閽阍闃阒闔阖闕阙關关闡阐闢辟陰阴陳陈陸陆陽阳階阶隕陨際际隤𬯎隨随險险隱隐雖虽雜杂雞鸡離离難难雲云電电靈灵靜静鞏巩響响頂顶順顺須须領领頤颐頰颊頻频顏颜顒颙願愿顙颡顛颠類类顯显風风飛飞飪饪飭饬飲饮飽饱飾饰養养餗𫗧餘余饋馈馬马馮冯馴驯駁驳驅驱驕骄驚惊體体髮发魚鱼鮒鲋鮮鲜鱉鳖鳥鸟鳴鸣鴻鸿鶴鹤鹵卤麗丽黃黄齊齐齎赍龍龙龜龟')

const HAN = /[㐀-䶿一-鿿豈-﫿]/
const WORD = /[\p{L}\p{N}]/u

function foldChar(cp: string): string {
  let out = ''
  for (const c of cp.normalize('NFKC').toLowerCase()) {
    const t = J2T.get(c) ?? c
    out += T2S.get(t) ?? t
  }
  return out
}
/** Matching form of any text. Never shown. */
export const fold = (s: string): string => [...s].map(foldChar).join('')

export type Segment = { key: string; from: number[]; to: number[] }

/** The Han runs of `text`, folded, with each character's span in the
 *  original. Punctuation and spaces join (a line may be typed with or without
 *  its commas); kana, Hangul, Latin letters and digits split, so kanji on
 *  either side of a Japanese particle never fuse into a false phrase. */
export function segments(text: string): Segment[] {
  const out: Segment[] = []
  let cur: Segment = { key: '', from: [], to: [] }
  let at = 0
  for (const cp of text) {
    const start = at
    at += cp.length
    for (const c of foldChar(cp)) {
      if (HAN.test(c)) { cur.key += c; cur.from.push(start); cur.to.push(at) }
      else if (WORD.test(c) && cur.key) { out.push(cur); cur = { key: '', from: [], to: [] } }
    }
  }
  if (cur.key) out.push(cur)
  return out
}
export const keyOf = (text: string): string => segments(text).map(s => s.key).join('')

// ── Phrases ────────────────────────────────────────────────────────────────

/** One quotable place: a 卦辭, 彖, 大象, 爻辭, 小象, 用九/六, a 文言 paragraph,
 *  or a 十翼 passage. `where` is its provenance as the teacher should cite it. */
export type Unit = { hex?: number; name?: string; where: string; text: string; key: string }
export type PhraseIndex = { units: Unit[]; joined: string; grams: Set<string> }
export type PhraseHit = { said: string; key: string; units: Unit[]; spoken?: true }

export const MIN_PHRASE = 4

/** `match` is what is compared (e.g. 「初九」 + the line), `text` what is shown. */
export function unit(u: { hex?: number; name?: string; where: string; text: string; match?: string }): Unit {
  const { match, ...rest } = u
  return { ...rest, key: keyOf(match ?? u.text) }
}

export function phraseIndex(units: Unit[]): PhraseIndex {
  const grams = new Set<string>()
  for (const u of units) for (let i = 0; i + MIN_PHRASE <= u.key.length; i++) grams.add(u.key.slice(i, i + MIN_PHRASE))
  return { units, joined: units.map(u => u.key).join('\u0001'), grams }
}

// Famous lines as people type them without characters: pinyin (with or
// without tone marks) and the Korean reading. Each maps to corpus text.
const SPOKEN: Array<[string, string[]]> = [
  ['元亨利貞', ['yuanhenglizhen', '원형이정']],
  ['潛龍勿用', ['qianlongwuyong', '잠룡물용']],
  ['見龍在田', ['xianlongzaitian', 'jianlongzaitian', '현룡재전']],
  ['飛龍在天', ['feilongzaitian', '비룡재천']],
  ['亢龍有悔', ['kanglongyouhui', '항룡유회']],
  ['羣龍无首', ['qunlongwushou', '군룡무수']],
  ['自強不息', ['ziqiangbuxi', '자강불식']],
  ['厚德載物', ['houdezaiwu', '후덕재물']],
  ['一陰一陽之謂道', ['yiyinyiyangzhiweidao', '일음일양지위도']],
]

/** Verbatim runs (≥4 characters) the text shares with the corpus, in the
 *  order they appear, each with every place it occurs. At most `limit`. */
export function phrasesIn(text: string, idx: PhraseIndex, limit = 3): PhraseHit[] {
  const hits: PhraseHit[] = []
  const add = (said: string, key: string, spoken = false) => {
    if (hits.some(h => h.key.includes(key))) return
    const units = idx.units.filter(u => u.key.includes(key))
    if (units.length) hits.push({ said, key, units, ...(spoken ? { spoken: true as const } : {}) })
  }
  for (const seg of segments(text)) {
    let end = 0
    for (let i = 0; i + MIN_PHRASE <= seg.key.length; i++) {
      if (!idx.grams.has(seg.key.slice(i, i + MIN_PHRASE))) continue
      let j = i + MIN_PHRASE
      while (j < seg.key.length && idx.joined.includes(seg.key.slice(i, j + 1))) j++
      if (j <= end) continue            // inside the previous, longer run
      end = j
      add(text.slice(seg.from[i], seg.to[j - 1]), seg.key.slice(i, j))
    }
  }
  const latin = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')
  const hangul = text.normalize('NFKC').replace(/[^가-힣]/g, '')
  for (const [line, sounds] of SPOKEN) {
    if (sounds.some(s => (/[a-z]/.test(s) ? latin : hangul).includes(s))) add(line, keyOf(line), true)
  }
  return hits.slice(0, limit)
}

/** Text the visitor put in quotation marks that is NOT in the corpus, so the
 *  teacher can say so instead of treating a later idiom as scripture. */
export function unfoundQuotes(text: string, idx: PhraseIndex, limit = 2): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/[「『“"]([^「」『』“”"\n]{1,60})[」』”"]/g)) {
    const key = keyOf(m[1])
    if (key.length < MIN_PHRASE || key.length > 24 || out.includes(m[1])) continue
    if (phrasesIn(m[1], idx).length === 0) out.push(m[1])
  }
  return out.slice(0, limit)
}

// ── Concepts ───────────────────────────────────────────────────────────────

export type ConceptId = 'career' | 'together' | 'yinyang'
/** `in` is a Unit's `where`; `quote` must occur in that unit exactly. */
type Anchor = { in: string; quote: string }
type Concept = { id: ConceptId; topic: string; words: string[]; en: RegExp; anchors: Anchor[] }

export const CONCEPTS: Concept[] = [
  {
    id: 'career', topic: '進退與工作抉擇',
    words: [
      '轉職', '換工作', '辭職', '離職', '跳槽', '升遷', '升職', '晉升', '職涯', '職場', '事業', '創業', '進退', '退休', '轉行', '裁員', '工作', '去留', '求職', '時機',
      '转职', '换工作', '辞职', '离职', '升迁', '升职', '晋升', '职涯', '职场', '事业', '创业', '进退', '转行', '裁员', '求职', '时机',
      '転職', '退職', '就職', '仕事', '昇進', 'キャリア', '起業', '異動', '会社を辞め',
      '이직', '퇴사', '취업', '직장', '승진', '커리어', '진로', '창업', '사직', '은퇴',
    ],
    en: /\b(careers?|jobs?|resign(?:ing|ation)?|promot(?:ion|ed)|retire(?:ment)?|workplace|employer|lay-?offs?|laid off|start(?:ing)? a business|advance or retreat|when to act)\b/i,
    anchors: [
      { in: '艮卦 彖傳', quote: '時止則止，時行則行，動靜不失其時，其道光明。' },
      { in: '乾卦 文言傳', quote: '上下无常，非為邪也。進退无恒，非離羣也。君子進德脩業，欲及時也。故无咎。' },
      { in: '《繫辭上傳》', quote: '變化者，進退之象也。' },
      { in: '《繫辭下傳》', quote: '君子藏器於身，待時而動，何不利之有。' },
      { in: '《繫辭下傳》', quote: '易窮則變，變則通，通則久' },
      { in: '升卦 大象', quote: '地中生木，升；君子以順德，積小以高大。' },
    ],
  },
  {
    id: 'together', topic: '合作與意見分歧',
    words: [
      '合作', '合夥', '夥伴', '搭檔', '共事', '同事', '團隊', '意見不合', '意見分歧', '分歧', '衝突', '爭執', '吵架', '不和', '鬧翻', '拆夥', '共識', '協作', '合不來', '股東', '上司', '主管', '老闆',
      '合伙', '伙伴', '搭档', '团队', '意见不合', '意见分歧', '冲突', '争执', '闹翻', '拆伙', '共识', '协作', '合不来', '股东', '老板',
      '協力', '協業', '提携', 'パートナー', '相棒', '同僚', 'チーム', '意見が合わない', '対立', '喧嘩', '共同経営', '仲間',
      '협업', '협력', '동업', '파트너', '동료', '팀', '갈등', '의견 충돌', '의견충돌', '의견이 맞지', '의견 차이', '다툼', '불화', '상사',
    ],
    en: /\b(partners?(?:hip)?|co-?founders?|cooperat(?:e|ion|ing)|collaborat(?:e|ion|ing|ors?)|teammates?|teamwork|colleagues?|co-?workers?|disagree(?:s|d|ment|ments)?|conflicts?|disputes?|falling out|fell out|my boss)\b/i,
    anchors: [
      { in: '睽卦 大象', quote: '上火下澤，睽；君子以同而異。' },
      { in: '睽卦 彖傳', quote: '天地睽，而其事同也；男女睽，而其志通也；萬物睽，而其事類也；睽之時用大矣哉！' },
      { in: '《繫辭上傳》', quote: '二人同心，其利斷金。同心之言，其臭如蘭。' },
      { in: '同人卦 大象', quote: '天與火，同人；君子以類族辨物。' },
      { in: '訟卦 大象', quote: '天與水違行，訟；君子以作事謀始。' },
      { in: '《繫辭下傳》', quote: '天下同歸而殊途，一致而百慮' },
    ],
  },
  {
    id: 'yinyang', topic: '陰陽與八卦的基本觀念',
    words: [
      '陰陽', '陰爻', '陽爻', '陰與陽', '陰和陽', '陰跟陽', '太極', '兩儀', '四象', '八卦', '剛柔', '陰卦', '陽卦',
      '阴阳', '阴爻', '阳爻', '阴与阳', '阴和阳', '阴跟阳', '太极', '两仪', '刚柔', '阴卦', '阳卦',
      '陰と陽', '両儀',
      '음양', '음과 양', '태극', '팔괘', '음효', '양효',
    ],
    en: /\b(yin|yin-yang|taiji|tai chi|supreme ultimate|trigrams?|(?:yang|broken|unbroken|solid) lines?)\b/i,
    anchors: [
      { in: '《繫辭上傳》', quote: '一陰一陽之謂道：繼之者善也，成之者性也' },
      { in: '《繫辭上傳》', quote: '是故易有太極，是生兩儀，兩儀生四象，四象生八卦' },
      { in: '《說卦傳》', quote: '立天之道，曰陰與陽；立地之道，曰柔與剛；立人之道，曰仁與義。' },
      { in: '《繫辭下傳》', quote: '乾，陽物也；坤，陰物也。陰陽合德，而剛柔有體' },
      { in: '《繫辭下傳》', quote: '陽卦多陰，陰卦多陽，其故何也？陽卦奇，陰卦偶。' },
      { in: '《繫辭上傳》', quote: '剛柔相推而生變化。' },
    ],
  },
]
const FOLDED = new Map(CONCEPTS.map(c => [c.id, c.words.map(fold)]))

/** Topics the text touches, in the index's fixed order. */
export function conceptsIn(text: string): ConceptId[] {
  const t = fold(text)
  const plain = text.normalize('NFKC')
  return CONCEPTS.filter(c => FOLDED.get(c.id)!.some(w => t.includes(w)) || c.en.test(plain)).map(c => c.id)
}

/** A concept's quotations, each checked against the corpus. A quotation the
 *  corpus no longer contains is dropped, never shown unverified. */
export function conceptPassages(id: ConceptId, units: Unit[]): { topic: string; lines: Array<{ where: string; quote: string }> } {
  const c = CONCEPTS.find(x => x.id === id)!
  return {
    topic: c.topic,
    lines: c.anchors
      .filter(a => units.some(u => u.where === a.in && u.text.includes(a.quote)))
      .map(a => ({ where: a.in, quote: a.quote })),
  }
}
