// lib/sukuyo-words.ts — 宿曜占星術's words per page language (lib/sukuyo.ts
// computes; this file only names). Kept apart so the room page can import
// it without the calendar tables.
//
// Client-safe.

/** The twenty-seven in 昴…胃 order, as 繁體 writes them (the teacher's facts). */
export const SHUKU_ZH = ['昴宿', '畢宿', '觜宿', '參宿', '井宿', '鬼宿', '柳宿', '星宿', '張宿', '翼宿', '軫宿', '角宿', '亢宿', '氐宿', '房宿', '心宿', '尾宿', '箕宿', '斗宿', '女宿', '虛宿', '危宿', '室宿', '壁宿', '奎宿', '婁宿', '胃宿']

type Lang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'
const REL_KEYS = ['命', '栄', '衰', '安', '危', '成', '壊', '友', '親', '業', '胎'] as const

export const SK_WORDS: Record<Lang, { shuku: string[]; rel: Record<(typeof REL_KEYS)[number], string>; pair: Record<string, string> }> = {
  ja: {
    shuku: ['昴宿', '畢宿', '觜宿', '参宿', '井宿', '鬼宿', '柳宿', '星宿', '張宿', '翼宿', '軫宿', '角宿', '亢宿', '氐宿', '房宿', '心宿', '尾宿', '箕宿', '斗宿', '女宿', '虚宿', '危宿', '室宿', '壁宿', '奎宿', '婁宿', '胃宿'],
    rel: { 命: '命', 栄: '栄', 衰: '衰', 安: '安', 危: '危', 成: '成', 壊: '壊', 友: '友', 親: '親', 業: '業', 胎: '胎' },
    pair: { 命: '命', 栄親: '栄親', 友衰: '友衰', 安壊: '安壊', 危成: '危成', 業胎: '業胎' },
  },
  'zh-Hant': {
    shuku: SHUKU_ZH,
    rel: { 命: '命', 栄: '榮', 衰: '衰', 安: '安', 危: '危', 成: '成', 壊: '壞', 友: '友', 親: '親', 業: '業', 胎: '胎' },
    pair: { 命: '命', 栄親: '榮親', 友衰: '友衰', 安壊: '安壞', 危成: '危成', 業胎: '業胎' },
  },
  'zh-Hans': {
    shuku: ['昴宿', '毕宿', '觜宿', '参宿', '井宿', '鬼宿', '柳宿', '星宿', '张宿', '翼宿', '轸宿', '角宿', '亢宿', '氐宿', '房宿', '心宿', '尾宿', '箕宿', '斗宿', '女宿', '虚宿', '危宿', '室宿', '壁宿', '奎宿', '娄宿', '胃宿'],
    rel: { 命: '命', 栄: '荣', 衰: '衰', 安: '安', 危: '危', 成: '成', 壊: '坏', 友: '友', 親: '亲', 業: '业', 胎: '胎' },
    pair: { 命: '命', 栄親: '荣亲', 友衰: '友衰', 安壊: '安坏', 危成: '危成', 業胎: '业胎' },
  },
  ko: {
    shuku: ['묘수', '필수', '자수', '삼수', '정수', '귀수', '류수', '성수', '장수', '익수', '진수', '각수', '항수', '저수', '방수', '심수', '미수', '기수', '두수', '여수', '허수', '위수(危)', '실수', '벽수', '규수', '루수', '위수(胃)'],
    rel: { 命: '명', 栄: '영', 衰: '쇠', 安: '안', 危: '위', 成: '성', 壊: '괴', 友: '우', 親: '친', 業: '업', 胎: '태' },
    pair: { 命: '명', 栄親: '영친', 友衰: '우쇠', 安壊: '안괴', 危成: '위성', 業胎: '업태' },
  },
  en: {
    shuku: ['Pleiades 昴', 'Net 畢', 'Turtle Beak 觜', 'Three Stars 参', 'Well 井', 'Ghost 鬼', 'Willow 柳', 'Star 星', 'Extended Net 張', 'Wings 翼', 'Chariot 軫', 'Horn 角', 'Neck 亢', 'Root 氐', 'Room 房', 'Heart 心', 'Tail 尾', 'Basket 箕', 'Dipper 斗', 'Girl 女', 'Emptiness 虚', 'Rooftop 危', 'Encampment 室', 'Wall 壁', 'Legs 奎', 'Bond 婁', 'Stomach 胃'],
    rel: { 命: 'Self', 栄: 'Thrive', 衰: 'Ebb', 安: 'Calm', 危: 'Risk', 成: 'Achieve', 壊: 'Break', 友: 'Friend', 親: 'Close', 業: 'Past', 胎: 'Seed' },
    pair: { 命: 'Self', 栄親: 'Thrive–Close', 友衰: 'Friend–Ebb', 安壊: 'Calm–Break', 危成: 'Risk–Achieve', 業胎: 'Past–Seed' },
  },
}
export const skWords = (lang: string) => SK_WORDS[(lang in SK_WORDS ? lang : 'zh-Hant') as Lang]
/** Whether a relation is conventionally good for the day (栄 親 友 成 安). */
export const GOOD_DAY = new Set(['栄', '親', '友', '成', '安'])
export const HARD_DAY = new Set(['衰', '危', '壊'])
