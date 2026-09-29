// lib/kyusei-words.ts — the 九星気学 board's words and colours per page
// language (lib/kyusei.ts computes; this file only names). Kept apart so the
// room page can import it without the calendar tables.
//
// Client-safe.

export type Dir = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
export const DIRS: Dir[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const STAR_ZH = ['', '一白水星', '二黑土星', '三碧木星', '四綠木星', '五黃土星', '六白金星', '七赤金星', '八白土星', '九紫火星']

type KyLang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'
export const KY_WORDS: Record<KyLang, { star: string[]; short: string[]; dir: Record<Dir | 'C', string>; tag: Record<'goou' | 'anken' | 'ha' | 'honmei' | 'honmeiTeki' | 'good' | 'best', string> }> = {
  ja: {
    star: ['', '一白水星', '二黒土星', '三碧木星', '四緑木星', '五黄土星', '六白金星', '七赤金星', '八白土星', '九紫火星'],
    short: ['', '一白', '二黒', '三碧', '四緑', '五黄', '六白', '七赤', '八白', '九紫'],
    dir: { N: '北', NE: '北東', E: '東', SE: '南東', S: '南', SW: '南西', W: '西', NW: '北西', C: '中央' },
    tag: { goou: '五黄殺', anken: '暗剣殺', ha: '破', honmei: '本命殺', honmeiTeki: '本命的殺', good: '吉', best: '最大吉' },
  },
  'zh-Hant': {
    star: STAR_ZH,
    short: ['', '一白', '二黑', '三碧', '四綠', '五黃', '六白', '七赤', '八白', '九紫'],
    dir: { N: '北', NE: '東北', E: '東', SE: '東南', S: '南', SW: '西南', W: '西', NW: '西北', C: '中宮' },
    tag: { goou: '五黃殺', anken: '暗劍殺', ha: '破', honmei: '本命殺', honmeiTeki: '本命的殺', good: '吉', best: '最大吉' },
  },
  'zh-Hans': {
    star: ['', '一白水星', '二黑土星', '三碧木星', '四绿木星', '五黄土星', '六白金星', '七赤金星', '八白土星', '九紫火星'],
    short: ['', '一白', '二黑', '三碧', '四绿', '五黄', '六白', '七赤', '八白', '九紫'],
    dir: { N: '北', NE: '东北', E: '东', SE: '东南', S: '南', SW: '西南', W: '西', NW: '西北', C: '中宫' },
    tag: { goou: '五黄杀', anken: '暗剑杀', ha: '破', honmei: '本命杀', honmeiTeki: '本命的杀', good: '吉', best: '最大吉' },
  },
  ko: {
    star: ['', '일백수성', '이흑토성', '삼벽목성', '사록목성', '오황토성', '육백금성', '칠적금성', '팔백토성', '구자화성'],
    short: ['', '일백', '이흑', '삼벽', '사록', '오황', '육백', '칠적', '팔백', '구자'],
    dir: { N: '북', NE: '북동', E: '동', SE: '남동', S: '남', SW: '남서', W: '서', NW: '북서', C: '중앙' },
    tag: { goou: '오황살', anken: '암검살', ha: '파', honmei: '본명살', honmeiTeki: '본명적살', good: '길', best: '최대길' },
  },
  en: {
    star: ['', '1 White Water', '2 Black Earth', '3 Jade Wood', '4 Green Wood', '5 Yellow Earth', '6 White Metal', '7 Red Metal', '8 White Earth', '9 Purple Fire'],
    short: ['', '1 White', '2 Black', '3 Jade', '4 Green', '5 Yellow', '6 White', '7 Red', '8 White', '9 Purple'],
    dir: { N: 'N', NE: 'NE', E: 'E', SE: 'SE', S: 'S', SW: 'SW', W: 'W', NW: 'NW', C: 'Centre' },
    tag: { goou: 'Five Yellow', anken: 'Dark Sword', ha: 'Breaker', honmei: 'Own star', honmeiTeki: 'Opposite own', good: 'Good', best: 'Best' },
  },
}
export const kyWords = (lang: string) => KY_WORDS[(lang in KY_WORDS ? lang : 'zh-Hant') as KyLang]
/** A star's colour, for the board's discs (一白 white … 九紫 purple). */
export const STAR_COLOR = ['', '#f4f1ea', '#2b2622', '#3f7f8f', '#4f8a4a', '#d8a93b', '#ece7dc', '#b8433a', '#f1ece2', '#6b4a8c']
export const STAR_LIGHT = [false, true, false, false, false, false, true, false, true, false]
/** The board as a Japanese 九星 chart draws it: 南 on top, 東 on the left. */
export const BOARD_LAYOUT: Array<Array<Dir | 'C'>> = [['SE', 'S', 'SW'], ['E', 'C', 'W'], ['NE', 'N', 'NW']]
