// lib/xtell-catalog.ts — everything XTell offers, in one versioned list.
//
// The front-door guide (app/api/xtell/assistant) is told what exists, what
// each feature needs and what it costs from THIS list, never from free text,
// and every action it offers is a feature id checked against it: the model
// names an id, the list decides where it goes. The guide's buttons, the
// handoff into a temple (lib/xtell-handoff.ts) and the tests that hold the
// list to the real chart route (scripts/test-xtell-assistant.ts) read it too.
//
// Maintenance rule: a feature added, changed or retired changes this list in
// the same commit — its status, inputs, fees and labels — together with
// content/xtell-guide.md, and bumps XTELL_CATALOG_VERSION (the guide's
// version line must match it). A feature is not delivered until the guide can
// describe it and send people to it. See docs/XTELL-PAGE.md "入口導覽".
//
// Client-safe: no server imports (the Temple type is erased at build).

import type { Temple } from './xtell'

/** Bumped with every change to this list or to content/xtell-guide.md. */
export const XTELL_CATALOG_VERSION = '2026-09-28.1'

export type FeatureId =
  | 'bazi' | 'bazi.chenggu' | 'ziwei' | 'yuelao' | 'guandi' | 'mazu' | 'simianfo' | 'navagraha'
  | 'zhanxing.natal' | 'zhanxing.synastry' | 'zhanxing.today' | 'zhanxing.year'
  | 'xingming' | 'cezi' | 'jiemeng' | 'yixue.ask' | 'yixue.lookup' | 'yixue.cast' | 'guanyin' | 'tarot'
  | 'daily' | 'almanac' | 'courses'

export type FeatureMode = 'natal' | 'synastry' | 'today' | 'year' | 'ask' | 'lookup' | 'cast'

/** What a room asks for besides the birth records and places. */
export type FeatureInput = 'wishes' | 'matter' | 'name' | 'gender' | 'character' | 'hexagram' | 'question' | 'year' | 'birth' | 'dream'

export type Feature = {
  id: FeatureId
  /** `pending` is described honestly and never offered as an action. */
  status: 'live' | 'pending'
  /** The room a live feature opens, and the mode it opens in. */
  temple?: Temple
  mode?: FeatureMode
  /** A live feature that is not a room but a section of the street itself:
   *  the daily fortune, today's almanac. */
  opens?: 'daily' | 'almanac'
  /** Birth records needed: none, one person, or two. */
  people: 0 | 1 | 2
  /** Whether an unknown birth hour is accepted; null when no birth is asked. */
  hour: 'required' | 'optional' | null
  /** A birth place (a city from the list) per person. */
  place: boolean
  /** Other inputs, required and optional. */
  inputs: FeatureInput[]
  optional: FeatureInput[]
  /** What costs nothing, and whether asking a teacher is charged. */
  free: Array<'chart' | 'draw' | 'lookup' | 'chenggu' | 'score' | 'daily' | 'almanac'>
  paid: 'teacher' | null
  /** Where a question prepared by the guide is placed: the teacher composer,
   *  or the field that names the matter (籤, 測字, 起卦). Never sent. */
  question: 'composer' | 'matter' | null
  /** i18n keys of the button label: the room, then the mode. */
  label: string[]
  /** For the guide's prompt: what it is for, plainly. Not shown to visitors. */
  about: string
}

const room = (t: Temple) => `xtell.site.focus.${t}.name`

export const XTELL_FEATURES: readonly Feature[] = [
  { id: 'bazi', status: 'live', temple: 'bazi', people: 1, hour: 'optional', place: false, inputs: [], optional: [],
    free: ['chart', 'chenggu'], paid: 'teacher', question: 'composer', label: [room('bazi')],
    about: 'BaZi four pillars from a birth date and hour: day master, elements, hidden stems, luck pillars; the board also shows the bone weight (稱骨). For personality, work, relationships, this year.' },
  { id: 'bazi.chenggu', status: 'live', temple: 'bazi', people: 1, hour: 'optional', place: false, inputs: [], optional: [],
    free: ['chart', 'chenggu'], paid: 'teacher', question: 'composer', label: [room('bazi'), 'xtell.as.mode.chenggu'],
    about: 'Bone weight (稱骨, 八字幾兩幾錢): the folk weight of the lunar birth year, month, day and hour, shown on the BaZi board. An unknown hour gives the possible totals instead of one.' },
  { id: 'ziwei', status: 'live', temple: 'ziwei', people: 1, hour: 'required', place: false, inputs: [], optional: [],
    free: ['chart'], paid: 'teacher', question: 'composer', label: [room('ziwei')],
    about: 'Zi Wei Dou Shu: twelve palaces with their stars and the current decade and year. Needs the birth hour.' },
  { id: 'yuelao', status: 'live', temple: 'yuelao', people: 2, hour: 'optional', place: false, inputs: [], optional: [],
    free: ['chart', 'score'], paid: 'teacher', question: 'composer', label: [room('yuelao')],
    about: 'Love and matching (合婚): two people\'s BaZi charts and a compatibility score with each row explained. Needs both birth dates.' },
  { id: 'guandi', status: 'live', temple: 'guandi', people: 0, hour: null, place: false, inputs: [], optional: ['matter', 'name', 'birth'],
    free: ['draw'], paid: 'teacher', question: 'matter', label: [room('guandi')],
    about: 'Guan Di oracle stick (靈籤): hold one matter in mind (writing it down is optional), draw a stick, confirm it with three positive block throws, then read the poem. A name, city and birth date may be added for context.' },
  { id: 'mazu', status: 'live', temple: 'mazu', people: 0, hour: null, place: false, inputs: [], optional: ['matter', 'name', 'birth'],
    free: ['draw'], paid: 'teacher', question: 'matter', label: [room('mazu')],
    about: 'Mazu sixty-stick oracle: the same draw and block ritual; strong on travel, safety, home and trade.' },
  { id: 'guanyin', status: 'live', temple: 'guanyin', people: 0, hour: null, place: false, inputs: [], optional: ['matter', 'name', 'birth'],
    free: ['draw'], paid: 'teacher', question: 'matter', label: [room('guanyin')],
    about: 'Guanyin temple oracle stick (觀音靈籤; 觀音廟 is the general name, not any one real temple): draw one of a hundred sticks and read its poem. Chinese, Korean and English pages draw from the 觀音一百籤 used across Taiwan and confirm with three block throws; Japanese pages draw from Ganzan Daishi\'s hundred Kannon poems (元三大師 觀音百籤), the origin of Japanese omikuji, with no blocks. Never name a real temple. Gentle; good for any worry, family, peace of mind.' },
  { id: 'tarot', status: 'live', temple: 'tarot', people: 0, hour: null, place: false, inputs: [], optional: ['matter'],
    free: ['draw'], paid: 'teacher', question: 'matter', label: [room('tarot')],
    about: 'Tarot (塔羅): write what you want to know, choose one card or three (past, present, future), and shuffle; the 1909 Waite–Smith cards are shown free, upright or reversed, with Waite\'s own meanings; the chosen teachers then read them. For love, choices, how things stand.' },
  { id: 'simianfo', status: 'live', temple: 'simianfo', people: 1, hour: 'optional', place: false, inputs: ['wishes'], optional: [],
    free: ['chart'], paid: 'teacher', question: 'composer', label: [room('simianfo')],
    about: 'Four-Faced Buddha: write a wish to at least one of the four faces (safety, career, marriage, wealth), optionally a pledge; the keeper reads which face this year favours from the visitor\'s BaZi. Wishing, not fortune-telling.' },
  { id: 'navagraha', status: 'live', temple: 'navagraha', people: 1, hour: 'required', place: true, inputs: [], optional: [],
    free: ['chart'], paid: 'teacher', question: 'composer', label: [room('navagraha')],
    about: 'Vedic (Jyotish) astrology: sidereal chart with the ascendant, nine grahas, nakshatras and the dasha timeline. Needs the birth hour and place.' },
  { id: 'zhanxing.natal', status: 'live', temple: 'zhanxing', mode: 'natal', people: 1, hour: 'optional', place: true, inputs: [], optional: [],
    free: ['chart'], paid: 'teacher', question: 'composer', label: [room('zhanxing'), 'xtell.astro.natal'],
    about: 'Western astrology natal chart: signs, houses and aspects. Without the hour, no ascendant or houses.' },
  { id: 'zhanxing.synastry', status: 'live', temple: 'zhanxing', mode: 'synastry', people: 2, hour: 'optional', place: true, inputs: [], optional: [],
    free: ['chart'], paid: 'teacher', question: 'composer', label: [room('zhanxing'), 'xtell.astro.synastry'],
    about: 'Western astrology compatibility between two people. Needs both birth dates and places.' },
  { id: 'zhanxing.today', status: 'live', temple: 'zhanxing', mode: 'today', people: 1, hour: 'optional', place: true, inputs: [], optional: [],
    free: ['chart'], paid: 'teacher', question: 'composer', label: [room('zhanxing'), 'xtell.astro.today'],
    about: 'Today\'s transits against the visitor\'s natal chart (Western astrology). The live way to look at today.' },
  { id: 'zhanxing.year', status: 'live', temple: 'zhanxing', mode: 'year', people: 1, hour: 'optional', place: true, inputs: [], optional: ['year'],
    free: ['chart'], paid: 'teacher', question: 'composer', label: [room('zhanxing'), 'xtell.astro.year'],
    about: 'The year ahead in Western astrology: solar return and progressions for a chosen year.' },
  { id: 'xingming', status: 'live', temple: 'xingming', people: 0, hour: null, place: false, inputs: ['name', 'gender'], optional: [],
    free: ['chart'], paid: 'teacher', question: 'composer', label: [room('xingming')],
    about: 'Name study (姓名學): strokes and the five grids of a surname and given name, 1 to 3 characters each: Chinese names, Japanese names in kanji, Korean names in hanja (not kana or Hangul).' },
  { id: 'cezi', status: 'live', temple: 'cezi', people: 0, hour: null, place: false, inputs: ['character'], optional: ['matter'],
    free: ['chart'], paid: 'teacher', question: 'matter', label: [room('cezi')],
    about: 'Character reading (測字): write one Chinese character, and optionally the matter asked about; the teacher takes the character apart.' },
  { id: 'jiemeng', status: 'live', temple: 'jiemeng', people: 0, hour: null, place: false, inputs: ['dream'], optional: ['matter'],
    free: ['lookup'], paid: 'teacher', question: 'matter', label: [room('jiemeng')],
    about: 'Dream reading (解夢, 周公解夢): write the dream, and optionally what you want to know; a quick AI picks the lines of the classic folk dream book 周公解夢 about what happens in the dream, shown free and quoted as written; then the chosen teachers read the dream against those lines and your situation. The dream may be written in any language. Up to 30 dreams a day.' },
  { id: 'yixue.ask', status: 'live', temple: 'yixue', mode: 'ask', people: 0, hour: null, place: false, inputs: ['question'], optional: [],
    free: [], paid: 'teacher', question: 'composer', label: [room('yixue'), 'xtell.yixue.mode.ask'],
    about: 'I Ching school, ask the teacher: learn the I Ching as a beginner; no hexagram is cast.' },
  { id: 'yixue.lookup', status: 'live', temple: 'yixue', mode: 'lookup', people: 0, hour: null, place: false, inputs: ['hexagram'], optional: [],
    free: ['lookup'], paid: 'teacher', question: 'composer', label: [room('yixue'), 'xtell.yixue.mode.lookup'],
    about: 'I Ching school, look up: read any of the 64 hexagrams in the original text.' },
  { id: 'yixue.cast', status: 'live', temple: 'yixue', mode: 'cast', people: 0, hour: null, place: false, inputs: ['matter'], optional: [],
    free: ['chart'], paid: 'teacher', question: 'matter', label: [room('yixue'), 'xtell.yixue.mode.cast'],
    about: 'I Ching casting practice: the visitor names one matter and throws three coins six times themselves. Only when they ask to cast.' },
  { id: 'daily', status: 'live', opens: 'daily', people: 1, hour: 'optional', place: false, inputs: [], optional: [],
    free: ['daily'], paid: 'teacher', question: null, label: ['xtell.as.feature.daily'],
    about: 'Free daily personal fortune on the street: Western astrology transits and the BaZi day, each with its own basis, for signed-in visitors who save their birth details (with consent; date, time or unknown, the time zone they were born in, today\'s zone; no city needed; no credit needed). A follow-up question to a teacher is paid.' },
  { id: 'almanac', status: 'live', opens: 'almanac', people: 0, hour: null, place: false, inputs: [], optional: [],
    free: ['almanac'], paid: null, question: null, label: ['xtell.as.feature.almanac'],
    about: 'Today\'s Chinese almanac (黃曆, the farmer\'s almanac) as a card on the street: the lunar date and the day\'s stem-branch, what the day is good for (宜) and should avoid (忌), the clashing animal and 煞 direction, the day officer and the solar term, with the day spirits and Pengzu taboos folded away. From the date alone: free, no birthday, no sign-in. Tradition, for reference.' },
  { id: 'courses', status: 'pending', people: 0, hour: null, place: false, inputs: [], optional: [],
    free: [], paid: null, question: null, label: ['xtell.as.feature.courses'],
    about: 'A learning centre with short lessons (Western astrology, Vedic astrology, Laozi). Planned, NOT live yet; the I Ching school is the live way to learn today.' },
]

const BY_ID = new Map<string, Feature>(XTELL_FEATURES.map(f => [f.id, f]))

/** The feature an id names, or null. */
export const featureOf = (id: unknown): Feature | null => (typeof id === 'string' ? BY_ID.get(id) ?? null : null)
/** A feature the guide may send someone to: live, with a room or a
 *  section of the street. */
export const liveFeature = (id: unknown): Feature | null => {
  const f = featureOf(id)
  return f && f.status === 'live' && (f.temple || f.opens) ? f : null
}

/** The fee rule every live feature follows, for the guide's prompt. */
export const FEE_RULE = 'Charts, stick draws, hexagram look-ups, the bone weight, the matching score, today\'s almanac and the daily fortune are free (the daily fortune needs no credit at all). Asking a teacher (an AI model the visitor picks) is charged per question at that model\'s listed price; the estimate is shown before sending, and nothing is sent without the visitor pressing send. New Google accounts start with US$10 of credit.'

/** The catalog as the guide's prompt reads it: one line per feature. */
export function catalogForPrompt(): string {
  const line = (f: Feature) => {
    const needs = [
      f.people === 2 ? 'two birth records' : f.people === 1 ? 'one birth record' : '',
      f.hour === 'required' ? 'birth hour required' : f.hour === 'optional' ? 'birth hour optional (unknown is allowed, with limits)' : '',
      f.place ? 'birth place' : '',
      ...f.inputs.map(i => i), ...f.optional.map(i => `${i} (optional)`),
    ].filter(Boolean).join(', ') || 'nothing'
    const cost = f.status === 'pending' ? 'n/a' : `free: ${f.free.join(', ') || 'entering'}; paid: ${f.paid === 'teacher' ? 'teacher reading per question' : 'none'}`
    return `- ${f.id} [${f.status.toUpperCase()}] ${f.about} Needs: ${needs}. Cost: ${cost}.`
  }
  return [
    'LIVE (the only ids allowed in "actions"):',
    ...XTELL_FEATURES.filter(f => f.status === 'live').map(line),
    '',
    'NOT LIVE (explain honestly; never offer as an action or say it is available):',
    ...XTELL_FEATURES.filter(f => f.status === 'pending').map(line),
  ].join('\n')
}
