'use client'
// app/xtell/client.tsx — the temple street.
//
// Each template is a temple (owner, Aug 29). Two temples in phase 1: 八字廟
// and 紫微斗數廟. The flow inside each is the same three steps, and the order
// is the point:
//
//   1. 稟明生辰 — a FORM, not an agent. Birth input is full of silent traps
//      (民國 vs 西元, 下午3:25 vs 15:25) and an extraction error produces a
//      confidently wrong chart — the one unforgivable failure here.
//   2. 排盤 — computed server-side by lunar-typescript / iztro and SHOWN.
//      This is the part the user can check against any 排盤 site, so it
//      renders before any money moves.
//   3. 請老師 — pick a model (the same picker every surface uses), optional
//      web search where the model supports it, and the reading streams in
//      as a 批文. The model interprets the chart; it never computes one.

import { useEffect, useId, useRef, useState } from 'react'
import { useSite } from '../../lib/useSite'
import XTellAuthGate from '../components/xtell/XTellAuthGate'
import { useAuthModal } from '../../lib/AuthModalContext'
import { SIGN_IN_FIRST } from '../../lib/xtell-guest'
import { TEMPLES, PURPOSES } from '../components/xtell/TempleStreet'
import { TempleArtwork } from '../components/xtell/TempleArtwork'
import { XTellFooter } from '../components/xtell/XTellNav'
import { createBrowserClient } from '@supabase/ssr'
import { useT, useLang, tOr } from '../../lib/i18n'
import { birthProblem, daysInMonth, birthYears, REMEMBER_KEY, rememberedBirth } from '../../lib/xtell-birth'
import { useRequireAuth } from '../../lib/useRequireAuth'
import type { PickerModel } from '../components/ModelPickerDialog'
import TeacherPicker from '../components/xtell/TeacherPicker'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '../../lib/markdown'
import ProviderLogo from '../components/ProviderLogo'
import { drawQian, throwJiao, cryptoRand, CONFIRM_THROWS, QIAN_COUNTS, asQianEdition, needsJiao, type Jiao, type QianEdition } from '../../lib/xtell-ritual'
import { drawTarot, asSpread, SPREADS, type TarotPick, type TarotSpread } from '../../lib/tarot-draw'
import { cookieProblem, FOOD_MAX, ASK_MAX as COOKIE_ASK_MAX } from '../../lib/xtell-cookie'
import { OptPill, OptGroup, SLOT_COLORS, thinkingLabel } from '../components/OptControls'

import { PLACES, placesFor, placeLabel, defaultPlaceFor } from '../../lib/xtell-places'
import { GRAHA_ZH, GRAHA_SA, RASI, NAKSHATRA } from '../../lib/jyotish'
import { PLANET_ZH, PLANET_GLYPH, POINT_ZH, SIGNS, ELEMENTS, MODALITIES, localStamp } from '../../lib/astrology'
import { throwCoins, valueOf, validLines, type Coin, type LineValue } from '../../lib/yijing-core'
import { YixueQuestion, YixueManualCast, YixueRitual, YixuePicker, YixueBoard } from '../components/xtell/Yixue'
import { describeVisit, eraseReading, notAskedKey, renameReading, cleanTitle, firstAsk } from '../../lib/xtell-history'
import { TitleEditor } from '../components/xtell/TitleEditor'
import { EST_PROMPT_TOKENS, EST_YIXUE_PROMPT_TOKENS, estimateReadingUsd, fmtUsdFor, levelsOf, defaultThinking } from '../../lib/xtell-presets'
import XTellAssistant from '../components/xtell/XTellAssistant'
import XTellDaily, { DailyBoard, dailyTemple, type SavedDaily } from '../components/xtell/XTellDaily'
import { AlmanacCard } from '../components/xtell/XTellToday'
import { ShareButton } from '../components/xtell/ShareButton'
import { WaitBar, WAIT_SECONDS } from '../components/xtell/WaitBar'
import { kyWords, STAR_COLOR, STAR_LIGHT, BOARD_LAYOUT } from '../../lib/kyusei-words'
import { skWords, GOOD_DAY, HARD_DAY } from '../../lib/sukuyo-words'
import { partialFields, readNdjson } from '../../lib/partial-json'
import { shareExcerpt } from '../../lib/xtell-share'
import { liveFeature, type FeatureId } from '../../lib/xtell-catalog'
import { cleanQuestion, clearHandoff, readHandoff, sessionStore, writeHandoff, type Handoff } from '../../lib/xtell-handoff'
import { chengguTheme, CHENGGU_MIN, CHENGGU_MAX } from '../../lib/xtell-chenggu-reading'
import { weightText, monthZh, dayZh, ZHI_SPAN, type Chenggu, type ChengguLunar } from '../../lib/xtell-chenggu'
import { asPersonalityType, offersPersonality } from '../../lib/xtell-personality'
import { PersonalityAttach, useSavedPersonality } from '../components/xtell/XTellPersonality'

type Temple = 'bazi' | 'ziwei' | 'yuelao' | 'guandi' | 'mazu' | 'simianfo' | 'navagraha' | 'zhanxing' | 'xingming' | 'cezi' | 'yixue' | 'jiemeng' | 'guanyin' | 'tarot' | 'cookie' | 'kyusei' | 'sukuyo' | 'sunzi'
/** The phone's local time as 'YYYY-MM-DDTHH:mm', for a datetime-local field. */
const localNow = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
const isQian = (t: Temple) => t === 'guandi' || t === 'mazu' || t === 'guanyin'

// Start with a question. Casting is an explicitly selected practice, never
// a prerequisite for talking to the teacher. Mirrors the server modes.
const YIXUE_MODES = ['ask', 'lookup', 'cast'] as const
type YixueMode = (typeof YIXUE_MODES)[number]
/** A row of xtell_readings, as the room reopens it. */
type SavedReading = { id: string; temple: string; subject: any; chart: any; extras: any; turns: any[] }

// 占星塔 is the one temple with rooms: four readings off one chart. The other
// six ask a single question, so their form is a birth row and their board is
// a chart; this one has to be told which reading before it can even ask for
// the right input (配對 needs a second person).
const ASTRO_MODES = ['natal', 'synastry', 'today', 'year'] as const
type AstroMode = (typeof ASTRO_MODES)[number]

// 四面佛's faces, clockwise. Mirrors FACES in lib/xtell.ts (server-only file).
const FACE_KEYS = ['peace', 'career', 'marriage', 'wealth'] as const
type Wishes = Partial<Record<(typeof FACE_KEYS)[number], string>> & { pledge?: string }

// The house default master (owner, Sep 24): Qwen 3.8 Flash — native in the
// classics and the temples' language, a hundredth of Sol's price. Thinking
// starts OFF since Sep 29 (with it on, a 塔羅 answer took 145 s). Max, then Sol,
// are the fallbacks if it ever leaves the catalog; the picker stays for
// anyone who wants another seat or a 合參.
const DEFAULT_MASTER = 'qwen3.8-flash'
/** Temples a 今日運勢 follow-up continues in (dailyTemple). */
const DAILY_HOME: Temple[] = ['zhanxing', 'bazi']
/** A setting's label stays on one line; a crowded row of pills wraps
 *  instead (four teachers, Sep 27: 「自動」 broke into 自 / 動). */
const nowrap: React.CSSProperties = { whiteSpace: 'nowrap' }
// Up to four masters at once (owner, Sep 24). Every seat keeps its own thread.
const MAX_SEATS = 4
const LAYOUT_KEY = 'xtell:layout'
const FALLBACK_MASTERS = ['qwen3.8-max', 'gpt-5.6-sol']

const mono = { fontFamily: 'var(--font-mono), monospace', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase' as const }
const card = { border: '1px solid var(--border2)', borderRadius: 12, background: 'var(--surface)' }

const HOURS = Array.from({ length: 24 }, (_, i) => i)
// Every minute (audit F04): on a 節 day one minute moves the 年柱 and 月柱
// (2000-02-04 20:40 is 己卯/丁丑, 20:41 庚辰/戊寅), so the form never rounds.
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
/** Temples whose chart cannot exist without the hour: 紫微 places 命宮 by
 *  it, 九曜 its 上升. The routes refuse an unknown hour for these too. */
const HOUR_REQUIRED: Temple[] = ['ziwei', 'navagraha']
/** lib/jiemeng.ts DREAM_MAX (that module reads the book from disk: server only). */
const DREAM_MAX = 1500
/** lib/sunzi.ts SITUATION_MAX, for the same reason. */
const SITUATION_MAX = 1500
/** Temples whose saved chart is recomputed (without saving) when a visit is
 *  reopened, so a record saved before the unknown-hour fix shows no 時柱 and
 *  a correct 合盤. Charts that move with today's date (紫微 流年, 占星 今日)
 *  keep what was saved, so a past conversation still matches its board. */
const REFRESHED: Temple[] = ['bazi', 'yuelao', 'simianfo', 'guandi', 'mazu']

/**
 * A refusal from /api/xtell/*, in the visitor's language (audit F05). The
 * routes send a stable `code`; `birth2_*` is the same message as `birth_*`
 * for the second person. An unknown code shows the raw message rather than
 * nothing.
 */
function errorText(t: (k: string) => string, code: string | undefined, raw: string): string {
  if (!code) return raw
  const m = code.match(/^(birth2?)_(.+)$/)
  if (m) {
    const msg = tOr(t, `xtell.err.birth.${m[2]}`, raw)
    return m[1] === 'birth2' ? t('xtell.err.second') + msg : msg
  }
  return tOr(t, `xtell.err.${code}`, raw)
}
class CodedError extends Error { constructor(message: string, readonly code?: string) { super(message) } }

/** Keep ?reading= pointing at the visit on screen, so a reload reopens the
 *  result the visitor just made rather than the record they started from
 *  (Codex review: an edited 紫微 visit reloaded into its old correction
 *  banner), and drop it when they leave the visit. */
function setReadingParam(id: string | null) {
  try {
    const url = new URL(window.location.href)
    if ((url.searchParams.get('reading') ?? null) === id) return
    if (id) url.searchParams.set('reading', id); else url.searchParams.delete('reading')
    window.history.replaceState(window.history.state, '', url)
  } catch { /* the URL is a convenience; the visit itself is saved */ }
}

/** The same checks the routes make, run on a subject before it is sent, and
 *  on a saved subject before its chart is shown. Null when it is fine. */
function subjectProblem(temple: Temple, subj: any, astroMode?: string): string | null {
  const needsBirth = !isQian(temple) && temple !== 'xingming' && temple !== 'cezi' && temple !== 'yixue' && temple !== 'jiemeng' && temple !== 'sunzi' && temple !== 'tarot' && temple !== 'cookie'
  if (needsBirth || (isQian(temple) && subj?.birth)) {
    const p = birthProblem(subj?.birth)
    if (p) return `birth_${p}`
    if (HOUR_REQUIRED.includes(temple) && subj.birth.hourUnknown) return 'birth_hour_required'
  }
  if (temple === 'yuelao' || (temple === 'zhanxing' && (astroMode ?? subj?.mode) === 'synastry')) {
    const p = birthProblem(subj?.birth2)
    if (p) return `birth2_${p}`
  }
  if (temple === 'simianfo' && !FACE_KEYS.some(k => String(subj?.wishes?.[k] ?? '').trim())) return 'wish_required'
  // lib/names.ts validName / validChar, mirrored.
  if (temple === 'xingming') {
    if (!/^[㐀-䶿一-鿿ぁ-ゖァ-ヺ][㐀-䶿一-鿿々ぁ-ゖァ-ヺー]{0,3}$/.test(String(subj?.surname ?? ''))) return 'surname_invalid'
    if (!/^[㐀-䶿一-鿿ぁ-ゖァ-ヺ][㐀-䶿一-鿿々ぁ-ゖァ-ヺー]{0,3}$/.test(String(subj?.given ?? ''))) return 'given_invalid'
  }
  if (temple === 'cezi' && !/^[㐀-䶿一-鿿]$/.test(String(subj?.ch ?? ''))) return 'char_invalid'
  // lib/jiemeng.ts dreamProblem, mirrored.
  if (temple === 'cookie') { const bad = cookieProblem(subj?.food, subj?.mealAt); if (bad) return bad }
  if (temple === 'jiemeng') { const d = String(subj?.dream ?? ''); if (!d.trim()) return 'dream_required'; if (d.length > DREAM_MAX) return 'dream_too_long' }
  // lib/sunzi.ts situationProblem, mirrored.
  if (temple === 'sunzi') { const d = String(subj?.situation ?? ''); if (!d.trim()) return 'situation_required'; if (d.length > SITUATION_MAX) return 'situation_too_long' }
  return null
}

/** Which form field a refusal is about, so the field itself is marked
 *  invalid and points at the message (audit F05). */
function fieldOf(code: string | null): string | null {
  if (!code) return null
  if (code.startsWith('birth2_')) return 'birth2'
  if (code.startsWith('birth_')) return 'birth'
  if (code === 'surname_invalid') return 'surname'
  if (code === 'given_invalid') return 'given'
  if (code === 'name_nodata') return 'name'
  if (code.startsWith('char_')) return 'char'
  if (code === 'wish_required') return 'wishes'
  if (code.startsWith('dream_')) return 'dream'
  if (code.startsWith('situation_')) return 'situation'
  if (code.startsWith('food_')) return 'food'
  if (code === 'meal_time_invalid') return 'mealAt'
  if (code === 'place_invalid') return 'place'
  if (code === 'place2_invalid') return 'place2'
  return null
}

/** One line of what a consultation was cast from, shown where a paid
 *  question is written so the visitor can confirm it first. */
function subjectSummary(t: (k: string) => string, temple: Temple, subj: any, lang = 'zh-Hant'): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const born = (b: any) => !b ? '' : `${b.y}-${pad(b.m)}-${pad(b.d)} ${b.hourUnknown ? t('xtell.hourunknown') : `${pad(b.h)}:${pad(b.mi)}`} · ${t(`xtell.${b.gender}`)}`
  const where = (k: unknown) => placeLabel(PLACES.find(p => p.key === k), lang)
  if (temple === 'yuelao' || (temple === 'zhanxing' && subj.mode === 'synastry')) {
    return `${t('xtell.person1')} ${born(subj.birth)}${subj.place ? ` · ${where(subj.place)}` : ''}　${t('xtell.person2')} ${born(subj.birth2)}${subj.place2 ? ` · ${where(subj.place2)}` : ''}`
  }
  if (temple === 'xingming') return `${subj.surname ?? ''}${subj.given ?? ''} · ${t(`xtell.${subj.gender}`)}`
  if (temple === 'cezi') return `「${subj.ch ?? ''}」${subj.ask ? ` · ${String(subj.ask).slice(0, 40)}` : ''}`
  if (temple === 'jiemeng') { const d = String(subj.dream ?? '').replace(/\s+/g, ' '); return `「${d.slice(0, 40)}${d.length > 40 ? '…' : ''}」` }
  if (temple === 'sunzi') { const d = String(subj.situation ?? '').replace(/\s+/g, ' '); return `「${d.slice(0, 40)}${d.length > 40 ? '…' : ''}」` }
  if (temple === 'cookie') return `${String(subj.food ?? '').slice(0, 40)}${subj.mealAt ? ` · ${String(subj.mealAt).replace('T', ' ')}` : ''}`
  if (isQian(temple) || temple === 'tarot') return subj.ask ? String(subj.ask).slice(0, 60) : ''
  // 九星気学 and 宿曜 read the date only: no hour or gender in the line.
  if (temple === 'kyusei' || temple === 'sukuyo') {
    const b = subj.birth
    return !b ? '' : `${b.y}-${pad(b.m)}-${pad(b.d)}${temple === 'sukuyo' && typeof subj.partner === 'string' ? ` × ${subj.partner}` : ''}`
  }
  return `${born(subj.birth)}${subj.place ? ` · ${where(subj.place)}` : ''}`
}
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const shichenOf = (h: number) => ZHI[h === 23 ? 0 : Math.floor((h + 1) / 2) % 12] + '時'

function RequireTempleAuth() { useRequireAuth(); return null }

export default function XTellClient({ standalone: standaloneOverride, almanacSection }: { standalone?: boolean; almanacSection?: React.ReactNode }) {
  const site = useSite()
  const standalone = standaloneOverride ?? site === 'xtell'
  const t = useT()
  const [temple, setTemple] = useState<Temple | null>(null)
  // www's card grid: the same purposes as the standalone street filter it.
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]['key'] | null>(null)
  // ?reading=<id> reopens a saved visit (supabase/105): the row is fetched
  // under the visitor's own session, the temple opens on it, and TempleRoom
  // starts from its subject, chart and turns instead of an empty form.
  const [saved, setSaved] = useState<SavedReading | null>(null)
  // Bumped by every Continue, so the room remounts even for the visit already on screen.
  const [opened, setOpened] = useState(0)
  // The front-door guide's suggestion for the room being opened (standalone
  // street only): the feature and the question it prepared. Kept in this
  // tab's sessionStorage too (lib/xtell-handoff.ts), so it survives a reload
  // or the sign-in round trip; the room re-derives its mode from the catalog.
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  // The daily fortune on the street: the guide's "daily" button bumps the
  // signal (scroll there, open the form). Asking a teacher about a day's
  // reading happens in that reading's temple (owner, Sep 28): 占星塔 for
  // 西洋占星, 八字廟 for 八字流日, with the follow-up visit as `dailyRow`.
  const [dailySignal, setDailySignal] = useState(0)
  const [dailyRow, setDailyRow] = useState<SavedDaily | null>(null)
  const openDaily = (row: SavedDaily) => {
    const key = dailyTemple(row.subject?.method)
    setReadingParam(row.id)
    setSaved(null)
    setDailyRow(row)
    if (standalone) window.location.hash = key
    setTemple(key)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('reading')
    if (!id) return
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    sb.from('xtell_readings').select('id, temple, subject, chart, extras, turns').eq('id', id).is('deleted_at', null).maybeSingle()
      .then(({ data }) => {
        if (data?.temple === 'daily') { openDaily(data as SavedDaily); return }
        if (!data || !TEMPLES.includes(data.temple)) return
        setSaved(data as SavedReading)
        if (standalone) window.location.hash = data.temple
        setTemple(data.temple as Temple)
      })
  }, [standalone])
  useEffect(() => {
    if (!standalone) return
    const sync = (navigated: boolean) => {
      const key = window.location.hash.slice(1) as Temple
      // Only an actual navigation out of a visit (a hash change to no
      // temple: the header's street link, Back) drops ?reading=. The first
      // sync on mount never does: an account link arrives as /?reading=<id>
      // with no hash yet, and clearing it there lost the visit before its
      // row had even loaded (Codex retest: recast then reload opened the
      // empty form). The row fetch sets the hash to its temple, which keeps it.
      const store = sessionStore()
      if (navigated && !TEMPLES.includes(key)) {
        setReadingParam(null)
        setDailyRow(null)
        // Back on the street (the header link, Back): the suggestion was
        // left behind, so a later visit to that room starts clean (Codex
        // review: it re-filled the old question on a manual entry).
        if (store) clearHandoff(store)
      }
      setTemple(TEMPLES.includes(key) ? key : null)
      // The guide's suggestion for this room: the one just clicked (in
      // memory), or, on the first sync after a page load only, the stored
      // one (a reload, or back from signing in). Storage is only that
      // fallback; a navigation never revives it.
      setHandoff(h => !TEMPLES.includes(key) ? null : h && h.feature.temple === key ? h : !navigated && store ? readHandoff(store, key) : null)
    }
    // A shared link (lib/xtell-share.ts) names its room as ?t=, which a link
    // preview can read and a hash cannot. It becomes the hash the street
    // already understands; ?ref= and utm_source stay for the referral and the
    // visit log.
    try {
      const url = new URL(window.location.href)
      const shared = url.searchParams.get('t') as Temple | null
      if (shared !== null) {
        url.searchParams.delete('t')
        if (TEMPLES.includes(shared) && !url.hash) url.hash = shared
        window.history.replaceState(window.history.state, '', url)
      }
    } catch { /* the room can still be chosen by hand */ }
    sync(false)
    const onHash = () => sync(true)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [standalone])
  // Resume from inside a temple (its history list): seed the room from the
  // saved row without a page load. Same path ?reading= takes.
  const resume = (row: SavedReading) => {
    // Every Continue opens the visit afresh (owner bug, Sep 28: after 修改資料,
    // Continue on the same visit did nothing, the room key was unchanged).
    setOpened(n => n + 1)
    if (row.temple === 'daily') { openDaily(row as unknown as SavedDaily); return }
    setDailyRow(null)
    setReadingParam(row.id)
    setSaved(row)
    if (standalone) window.location.hash = row.temple
    setTemple(row.temple as Temple)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  const chooseTemple = (key: Temple | null) => {
    if (standalone) window.location.hash = key ?? ''
    setTemple(key)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  // A button in the guide's reply: open that room with its mode and the
  // prepared question. Only a live catalog feature opens anything.
  const openFromGuide = (id: FeatureId, question: string | null) => {
    const feature = liveFeature(id)
    if (feature?.opens === 'daily') { setDailySignal(n => n + 1); return }
    // Today's almanac is a card on the street itself.
    if (feature?.opens) { document.getElementById(`xtell-${feature.opens}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    if (!feature?.temple) return
    const store = sessionStore()
    if (store) writeHandoff(store, feature.id, question)
    setHandoff({ feature, question: feature.question ? cleanQuestion(question) : null })
    setReadingParam(null)
    setSaved(null)
    setDailyRow(null)
    chooseTemple(feature.temple)
  }
  const leaveRoom = () => {
    const store = sessionStore()
    if (store) clearHandoff(store)
    setHandoff(null)
    setReadingParam(null)
    setSaved(null)
    setDailyRow(null)
    chooseTemple(null)
  }

  if (standalone) return <div className="xtell-site">
    <main id="xtell-main" className={'xtell-container' + (!temple ? ' xtell-explorer-container' : ' xtell-room-container')} tabIndex={-1}>
      {!temple ? <>
        {/* The guide first, then today (owner, Sep 27): the Chinese almanac
            on the left, the daily fortune on the right. The temples
            themselves are in the top bar. */}
        <XTellAssistant onOpen={openFromGuide} />
        <div className="xtell-today">
          {/* Its own section, rendered on the server (AlmanacSection). */}
          {almanacSection ?? <AlmanacCard />}
          <XTellDaily openSignal={dailySignal} onContinue={openDaily} />
        </div>
      </> : <>
        {/* Signed out, a room still casts its free chart; sign-in is asked
            at the first question to a teacher (owner, Oct 1). Three rooms
            stay sign-in first (lib/xtell-guest.ts). */}
        {SIGN_IN_FIRST.has(temple) && <XTellAuthGate />}
        <TempleRoom key={temple + (saved?.id ?? '') + (dailyRow ? `:daily:${dailyRow.id}` : '') + (handoff?.feature.temple === temple ? handoff.feature.id : '') + `:${opened}`} temple={temple} onBack={leaveRoom} standalone initial={saved?.temple === temple ? saved : null}
          daily={dailyRow && dailyTemple(dailyRow.subject?.method) === temple ? dailyRow : null}
          handoff={saved?.temple === temple || handoff?.feature.temple !== temple ? null : handoff} onResume={resume} />
      </>}
    </main>
    <XTellFooter />
  </div>

  return (
    <div className="xduel-page">
      <RequireTempleAuth />
      <div className="arena">
        {/* House in-page header (XBoard/XEval pattern). The red "//" is drawn
            by .prompt-label.eyebrow in CSS, never typed into the string, and
            .page-headline sets the title size. This header was hand-rolled. */}
        <div className="prompt-label eyebrow">{t('xtell.eyebrow')}</div>
        <h1 className="page-headline" style={{ marginBottom: 10 }}>{t('xtell.title')}</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.65, maxWidth: 700, margin: '0 0 34px' }}>{t('xtell.sub')}</p>

        {!temple ? (<>
          <div role="group" aria-label={t('xtell.purpose.title')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('xtell.purpose.title')}</span>
            {([null, ...PURPOSES.map(p => p.key)] as Array<(typeof PURPOSES)[number]['key'] | null>).map(key => (
              <button key={key ?? 'all'} type="button" aria-pressed={purpose === key} onClick={() => setPurpose(key)} style={{
                padding: '6px 13px', borderRadius: 999, fontSize: 12.5, cursor: 'pointer',
                border: `1px solid ${purpose === key ? 'var(--red)' : 'var(--border2)'}`, background: purpose === key ? 'var(--surface2)' : 'transparent',
                color: purpose === key ? 'var(--red)' : 'var(--white)', fontWeight: purpose === key ? 700 : 500,
              }}>{t('xtell.purpose.' + (key ?? 'all'))}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {(['bazi', 'ziwei', 'yuelao', 'guandi', 'mazu', 'simianfo', 'navagraha', 'zhanxing', 'xingming', 'cezi', 'yixue', 'jiemeng'] as Temple[])
              .filter(k => !purpose || PURPOSES.find(p => p.key === purpose)!.temples.includes(k)).map(k => (
              <div key={k} role="link" tabIndex={0} onClick={() => setTemple(k)}
                onKeyDown={e => { if (e.key === 'Enter') setTemple(k) }}
                style={{ ...card, overflow: 'hidden', cursor: 'pointer', transition: 'border-color .2s, transform .2s' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.transform = 'none' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* Preserve the complete school illustration in the wide card. */}
                <img src={k === 'yixue' ? '/xtell/approved/yixue-school-portrait.avif' : `/xtell/${k}.jpg`} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: k === 'yixue' ? 'contain' : 'cover', background: k === 'yixue' ? '#faf6f0' : undefined, display: 'block' }} />
                <div style={{ padding: '14px 18px 16px' }}>
                  <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{t(`xtell.${k}.name`)}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{t(`xtell.${k}.desc`)}</div>
                </div>
              </div>
            ))}
          </div>
        </>) : (
          <TempleRoom key={temple + (saved?.id ?? '') + (dailyRow ? `:daily:${dailyRow.id}` : '') + `:${opened}`} temple={temple} onBack={() => { setReadingParam(null); setSaved(null); setDailyRow(null); setTemple(null) }} initial={saved?.temple === temple ? saved : null}
            daily={dailyRow && dailyTemple(dailyRow.subject?.method) === temple ? dailyRow : null} onResume={resume} />
        )}

        <div style={{ marginTop: 40, fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.disclaimer')}</div>
      </div>
    </div>
  )
}

/** `daily`: a day's 今日運勢 reading continued in its temple (owner, Sep 28):
 *  the reading replaces the chart and the form, questions go to the reading
 *  route as that day's follow-up (temple 'daily', the stored reading), and
 *  the way back leads to the street. */
function TempleRoom({ temple, onBack, standalone = false, initial = null, daily = null, onResume, handoff = null }: { temple: Temple; onBack: () => void; standalone?: boolean; initial?: SavedReading | null; daily?: SavedDaily | null; onResume?: (r: SavedReading) => void; handoff?: Handoff | null }) {
  const t = useT()
  const { show: showSignIn } = useAuthModal()
  // The site language rides with every reading so the master answers in it
  // (owner, Sep 24) — a Japanese visitor pressing the Chinese pre-filled
  // question still gets Japanese. The visitor writing in another language
  // still wins, per the prompt.
  const { lang } = useLang()
  // A reopened reading seeds every input from its saved subject, so the
  // requests it sends next are byte-for-byte what the original visit sent.
  const init = initial?.subject ?? {}
  // 觀音廟 draws from 元三大師's 觀音百籤 on Japanese pages and the 觀音一百籤
  // elsewhere; a reopened visit keeps the set it was drawn from. 元三大師's set
  // throws no 筊.
  const edition: QianEdition = asQianEdition(init.edition ?? (lang === 'ja' ? 'gansan' : 'yibai'))
  const jiao = needsJiao(temple, edition)
  // 塔羅: the spread, and the cards the browser dealt (only their ids travel).
  const [spread, setSpread] = useState<TarotSpread>(asSpread(init.spread))
  const picksRef = useRef<TarotPick[] | null>(Array.isArray(init.picks) ? init.picks : null)
  const defaultBirth = { y: 1990, m: 1, d: 1, h: 12, mi: 0, gender: 'male' as 'male' | 'female', hourUnknown: false }
  const [birth, setBirth] = useState<typeof defaultBirth>({ ...defaultBirth, ...(init.birth ?? {}), ...(init.gender && !init.birth ? { gender: init.gender } : {}),
    // 紫微/九曜 hide the checkbox; a record saved with it set must reopen
    // with the hour selectable so the visitor can correct it.
    ...(HOUR_REQUIRED.includes(temple) ? { hourUnknown: false } : {}) })
  const [readingId, setReadingId] = useState<string | null>(initial?.id ?? daily?.id ?? null)
  // 月老廟 needs a second person. Defaults to the other gender purely as a
  // starting point — both rows are fully editable, a couple is whoever they are.
  const [birth2, setBirth2] = useState<typeof defaultBirth>({ ...defaultBirth, gender: 'female', ...(init.birth2 ?? {}) })
  const [entered, setEntered] = useState(!!initial || !!daily)
  const [chart, setChart] = useState<any>(initial?.chart ?? null)
  const [match, setMatch] = useState<any>(initial?.extras?.match ?? null)   // 月老廟's computed 合盤
  const [year, setYear] = useState<any>(initial?.extras?.year ?? null)     // 四面佛's (and an optional 稟告's) computed 流年
  const [bazi, setBazi] = useState<any>(initial?.extras?.bazi ?? null)     // 稟告 birth → 八字, shown under the stick
  const [chenggu, setChenggu] = useState<Chenggu | null>(initial?.extras?.chenggu ?? null)   // 八字廟's 稱骨 weights
  // 關帝/媽祖 稟告: optional name, city, and whether to attach `birth`.
  const [bing, setBing] = useState({ name: init.name ?? '', city: init.city ?? '', withBirth: !!(init.birth && isQian(temple)) })
  // 關帝廟: the matter asked, and the ritual. The poem is never in the client
  // until the third 聖筊 — the server sends it with the chart response.
  // From the front-door guide: the question it prepared goes to the field
  // the catalog names (the matter, or the teacher composer below). Only a
  // handoff for this very room arrives here; nothing is sent.
  const carried = handoff?.feature.temple === temple ? handoff : null
  const [ask, setAsk] = useState(init.ask ?? (carried?.feature.question === 'matter' ? carried.question ?? '' : ''))
  const [stick, setStick] = useState<{ n: number; throws: Jiao[] } | null>(isQian(temple) && init.n ? { n: init.n, throws: ['聖筊', '聖筊', '聖筊'] } : null)
  const [ritual, setRitual] = useState<'idle' | 'drawn' | 'rejected' | 'confirmed'>(initial && isQian(temple) && init.n ? 'confirmed' : 'idle')
  // 四面佛: one wish per face, plus the pledge.
  const [wishes, setWishes] = useState<Wishes>(init.wishes ?? {})
  // 姓名亭: surname + given name; 測字亭: one character (+ the shared `ask`).
  const [surname, setSurname] = useState(init.surname ?? '')
  const [given, setGiven] = useState(init.given ?? '')
  const [ch, setCh] = useState(init.ch ?? '')
  const [dream, setDream] = useState(init.dream ?? '')
  // 孫子兵法: the situation as the visitor tells it (+ the shared `ask`).
  const [situation, setSituation] = useState(init.situation ?? '')
  // The visitor's own personality type (Sep 30): attached only while the box
  // is ticked, never by default; a reopened visit keeps the type it was asked
  // with. 月老 may add the other person's type, typed in here.
  const savedType = useSavedPersonality(offersPersonality(temple))
  const [withType, setWithType] = useState<boolean>(!!asPersonalityType(init.mbti))
  const [partnerType, setPartnerType] = useState<string>(asPersonalityType(init.mbti2) ?? '')
  const typeToSend = offersPersonality(temple) && withType ? (asPersonalityType(init.mbti) ?? savedType ?? null) : null
  const partnerToSend = temple === 'yuelao' ? asPersonalityType(partnerType) : null
  const typeSubject = { ...(typeToSend ? { mbti: typeToSend } : {}), ...(partnerToSend ? { mbti2: partnerToSend } : {}) }
  // 幸運餅乾: what was eaten, and when (the phone's local time, editable).
  const [food, setFood] = useState<string>(init.food ?? '')
  const [mealAt, setMealAt] = useState<string>(typeof init.mealAt === 'string' ? init.mealAt : localNow())
  // 九星気学: a reopened visit keeps the date it was cast on.
  const [kyToday] = useState<string>(typeof init.today === 'string' ? init.today : localNow().slice(0, 10))
  // 宿曜: an optional partner's birth date, for the two people's relation.
  const [partnerDate, setPartnerDate] = useState<string>(typeof init.partner === 'string' ? init.partner : '')
  // 九曜廟: the birth place (a curated city key; coordinates + zone resolve server-side).
  const [place, setPlace] = useState(init.place ?? defaultPlaceFor(lang))
  // 占星塔 only.
  const [astroMode, setAstroMode] = useState<AstroMode>(temple === 'zhanxing' && init.mode ? init.mode
    : temple === 'zhanxing' && (ASTRO_MODES as readonly string[]).includes(carried?.feature.mode ?? '') ? carried!.feature.mode as AstroMode : 'natal')
  // 易學堂: the room, the cast so far (six line values and the coin faces
  // behind them) and the hexagram picked in 查卦. The cast lives in a ref
  // mirrored into state, like the 籤 ritual: two fast clicks inside one
  // render must not both read the same five lines.
  const [yixueMode, setYixueMode] = useState<YixueMode>(temple === 'yixue' && (YIXUE_MODES as readonly string[]).includes(init.mode) ? init.mode
    : temple === 'yixue' && (YIXUE_MODES as readonly string[]).includes(carried?.feature.mode ?? '') ? carried!.feature.mode as YixueMode : 'ask')
  const castRef = useRef<{ values: LineValue[]; coins: Coin[][] }>({
    values: temple === 'yixue' && Array.isArray(init.lines) ? init.lines : [],
    coins: temple === 'yixue' && Array.isArray(init.coins) ? init.coins : [],
  })
  const [cast, setCast] = useState(castRef.current)
  const [castEntering, setCastEntering] = useState(false)
  const [castFailed, setCastFailed] = useState(false)
  const [castMethod, setCastMethod] = useState<'coins' | 'manual'>('coins')
  const [manualLines, setManualLines] = useState<Array<LineValue | ''>>(['', '', '', '', '', ''])
  const [lookupN, setLookupN] = useState<number | null>(temple === 'yixue' && Number.isInteger(init.n) ? init.n : null)
  const yixueEntryPending = useRef(false)
  const [yixueEntryBusy, setYixueEntryBusy] = useState(false)
  // 進廟 in flight: the chart route, or 解夢's lookup (1-3 s). The form shows
  // it moving (owner, Sep 27: "it shows nothing but freezed").
  const [entering, setEntering] = useState(false)
  const enteringRef = useRef(false)
  // The teacher must receive the same subject that produced the visible
  // board, even if an entry control was changed while its request loaded.
  const yixueSubject = useRef<Record<string, unknown> | null>(temple === 'yixue' && initial ? { temple, ...init } : null)
  const [place2, setPlace2] = useState(init.place2 ?? defaultPlaceFor(lang))
  const [srYear, setSrYear] = useState(init.year ?? new Date().getFullYear())
  // Shown by default. The computed chart is the whole reason this page is not
  // just a chat window, and it was hidden behind a link nobody clicked.
  const [err, setErr] = useState<string | null>(null)
  const [errCode, setErrCode] = useState<string | null>(null)
  // The raw message and its code are kept, not a translated sentence, so a
  // language switch retranslates an error already on screen (Codex review:
  // it stayed in the old language). An uncoded provider message is shown as
  // it came.
  const fail = (raw: string, code?: string | null) => { setErr(raw); setErrCode(code ?? null) }
  const clearErr = () => { setErr(null); setErrCode(null) }
  const errShown = err ? errorText(t, errCode ?? undefined, err) : null
  const errId = useId()
  const errField = fieldOf(errCode)
  /** aria props for a field the current refusal is about. */
  const fieldAria = (field: string) => errField === field || (errField === 'name' && (field === 'surname' || field === 'given'))
    ? { invalid: true, describedBy: errId } : { invalid: false, describedBy: undefined }
  // A reopened visit whose saved inputs are no longer accepted (a 2 月 31 日
  // saved before the date check, an unknown hour saved in 紫微): its stored
  // chart was computed from an impossible input, so it is not shown; the
  // visitor is asked to correct the details (audit F01/F02, Codex review).
  const [savedProblem, setSavedProblem] = useState<string | null>(() => (initial ? subjectProblem(temple, init) : null))
  // A saved visit cast with an unknown hour before the fix carries a noon
  // 時柱, a 合盤 scored on it and no 節-day doubt; hiding the hour cell alone
  // still shows those (Codex review, Sep 26). So such a board is not shown,
  // and no paid question is taken, until the refresh has recomputed it. If
  // the refresh cannot answer, the visitor gets Retry and 修改資料; the
  // saved conversation stays on screen and in the row either way. A visit
  // with every hour known shows its saved chart at once (still refreshed).
  const refreshes = !!initial && REFRESHED.includes(temple) && !(isQian(temple) && !init.birth)
  const staleRisk = refreshes && [init.birth, init.birth2].some((b: any) => b?.hourUnknown === true)
  const [check, setCheck] = useState<'ok' | 'pending' | 'failed'>(() => (staleRisk && !savedProblem ? 'pending' : 'ok'))
  const unverified = check !== 'ok'
  // Bumped by every edit and every cast: a refresh of the saved subject that
  // answers after the visitor has recast must not overwrite the new chart.
  const refreshToken = useRef(0)
  const refreshSaved = () => {
    const token = ++refreshToken.current
    if (staleRisk) setCheck('pending')
    // Recompute, never save (the route's `refresh`): the row stays as it was.
    fetch('/api/xtell/chart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...init, temple, refresh: true }) })
      .then(async res => {
        const d = await res.json().catch(() => ({}))
        if (token !== refreshToken.current) return
        // A 4xx with a code is a verdict on the saved inputs (a date that
        // does not exist, an unknown hour where one is required). A 5xx, an
        // expired session or a network failure says nothing about the
        // birthday, so it is offered again rather than called invalid.
        if (res.status >= 400 && res.status < 500 && typeof d?.code === 'string') { setSavedProblem(d.code); setCheck('ok'); return }
        if (!res.ok) { setCheck(staleRisk ? 'failed' : 'ok'); return }
        setChart(d.chart); setMatch(d.match ?? null); setYear(d.year ?? null); setBazi(d.bazi ?? null); setChenggu(d.chenggu ?? null)
        setCheck('ok')
      })
      .catch(() => { if (token === refreshToken.current) setCheck(staleRisk ? 'failed' : 'ok') })
  }
  useEffect(() => {
    if (refreshes && !savedProblem) refreshSaved()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Up to two masters. The default seat is the house pick — the latest good
  // text model (GPT-5.6 Sol) — preselected so the temple works with zero
  // configuration; the picker is there for people who care.
  const [masters, setMasters] = useState<PickerModel[]>([])
  // Every model offered here, for the presets.
  const [catalog, setCatalog] = useState<PickerModel[]>([])
  // Measured seconds to a teacher's first word, per thinking level
  // (/api/xtell/speed). Shown on the seats beside the price; a model nobody
  // has measured shows the price alone.
  const [speeds, setSpeeds] = useState<Record<string, Record<string, number>>>({})
  useEffect(() => {
    let live = true
    fetch('/api/xtell/speed').then(r => r.ok ? r.json() : null).then(d => { if (live && d?.speeds) setSpeeds(d.speeds) }).catch(() => {})
    return () => { live = false }
  }, [])
  /** The seat's first-word time: the measured number at its thinking level,
   *  or the measured range when that level was not measured (自動 included). */
  const firstWord = (m: PickerModel, level: string | null): string | null => {
    const dots = speeds[m.id]
    if (!dots) return null
    if (level != null && dots[level] != null) return dots[level].toFixed(1)
    const v = Object.values(dots)
    if (v.length === 0) return null
    const lo = Math.min(...v), hi = Math.max(...v)
    return lo === hi ? lo.toFixed(1) : `${lo.toFixed(1)}–${hi.toFixed(1)}`
  }
  // The picker either adds a seat or replaces one (owner, Sep 24: the first
  // master must be changeable too, not only the second).
  const [picker, setPicker] = useState<null | { replace: string | null; join?: boolean }>(null)
  // Per-seat settings, the way XCreate configures each slot: thinking level
  // (from the row's declared levels) and web search (where the row declares
  // the capability). Defaults are computed, so an untouched seat needs no
  // entry. Every Qwen row defaults to thinking OFF: Max's own default sat
  // 130 s before the first token on a 紫微 prompt, and Flash's thinking made
  // a 塔羅 answer 9,728 tokens and 145 s (Sep 29).
  type SeatOpts = { thinking: string | null; search: boolean }
  const [seatOpts, setSeatOpts] = useState<Record<string, SeatOpts>>({})
  // ⚙ on any chip opens the settings panels for ALL seated masters together,
  // the way XCreate's gear works (owner, Sep 24: follow XCreate). Collapsed
  // by default; the defaults are fine for most visits.
  const [optsOpen, setOptsOpen] = useState(false)
  // How several masters' replies are shown (owner, Sep 24): side by side
  // (each column at least 360 px, the row scrolls sideways) or one at a time
  // behind a button group. Phones default to tabs; the choice is remembered.
  const [layout, setLayout] = useState<'columns' | 'tabs'>('columns')
  const [tab, setTab] = useState<string | null>(null)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY)
      if (saved === 'columns' || saved === 'tabs') { setLayout(saved); return }
    } catch { /* ignore */ }
    if (window.innerWidth < 900) setLayout('tabs')
  }, [])
  const chooseLayout = (l: 'columns' | 'tabs') => { setLayout(l); try { localStorage.setItem(LAYOUT_KEY, l) } catch { /* ignore */ } }
  const searchable = (m: PickerModel) => ((m.output_config?.text?.capabilities ?? []) as string[]).includes('web_search')
  const defaultOpts = (m: PickerModel): SeatOpts => ({ thinking: defaultThinking(m), search: false })
  const optsOf = (m: PickerModel): SeatOpts => seatOpts[m.id] ?? defaultOpts(m)
  const setOpts = (m: PickerModel, patch: Partial<SeatOpts>) => setSeatOpts(o => ({ ...o, [m.id]: { ...optsOf(m), ...patch } }))

  // One shared conversation. A question goes to every seated master or to
  // the ones the visitor picks (owner, Sep 27); it remembers both (`to`, and
  // `seats`: who was seated), so each master's thread holds only the
  // questions put to it, and a reopened visit re-seats the same table. A
  // question saved before this has neither and counts as asked of all.
  type Turn = { role: 'user'; content: string; to?: string[]; seats?: string[]; qid?: string } | { role: 'assistant'; content: string; modelId: string; name: string; provider: string; cost?: number }
  const idList = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
  const [turns, setTurns] = useState<Turn[]>(() => ((initial ?? daily)?.turns ?? []).map((x: any) => x.role === 'user'
    ? { role: 'user', content: String(x.content ?? ''), to: idList(x.to), seats: idList(x.seats), qid: typeof x.qid === 'string' ? x.qid : undefined }
    : { role: 'assistant', content: String(x.content ?? ''), modelId: x.modelId ?? '', name: x.name ?? '', provider: x.provider ?? '', cost: typeof x.cost === 'number' ? x.cost : undefined }))
  // Whom the next question goes to: null is every seated master. Picked
  // ids no longer seated drop out; if none are left, it is everyone again.
  const [askTo, setAskTo] = useState<string[] | null>(null)
  const recipients = (() => {
    const picked = (askTo ?? []).filter(id => masters.some(m => m.id === id))
    return picked.length ? masters.filter(m => picked.includes(m.id)) : masters
  })()
  const askingAll = recipients.length === masters.length
  const toggleAsk = (id: string) => setAskTo(() => {
    const cur = recipients.map(m => m.id)
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
    return next.length === 0 || next.length === masters.length ? null : next
  })
  const askOnly = (id: string) => {
    setAskTo([id])
    composerRef.current?.focus()
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const [input, setInput] = useState(carried?.feature.question === 'composer' ? carried.question ?? '' : '')
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const questionRequired = temple === 'yixue' && yixueMode === 'ask'
  const [busy, setBusy] = useState(false)
  // Teachers added to the latest question after it was asked (owner, Sep 28:
  // 追加老師). While one is answering, no new question can be sent, so its
  // reply lands under the question it answers.
  const [joining, setJoining] = useState<string[]>([])
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Default master. Falls back to the newest enabled text model if the
    // house pick ever leaves the catalog — the temple must never open empty.
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    sb.from('ai_models')
      .select('id, provider, model_name, display_name, modes, model_pricing, output_config, blocked_features')
      .eq('enabled', true).contains('output_modalities', ['text'])
      .then(({ data }) => {
        const rows = (data ?? []).filter(r => !(r.blocked_features ?? []).includes('xtell'))
        setCatalog(rows as PickerModel[])
        // A reopened reading re-seats the table of its last question (its
        // `seats`, so a last question put to one teacher still brings back
        // all four); a question saved before that re-seats whoever answered
        // it, in order (owner, Sep 24). A master since removed from the
        // catalog is simply not re-seated.
        const saved = (initial ?? daily)?.turns
        if (saved?.length) {
          const lastUser = saved.map((x: any) => x.role).lastIndexOf('user')
          const ids: string[] = [...(idList(saved[lastUser]?.seats) ?? [])]
          if (!ids.length) for (const x of saved.slice(lastUser + 1)) if (x.role === 'assistant' && x.modelId && !ids.includes(x.modelId)) ids.push(x.modelId)
          const seated = ids.map(id => rows.find(r => r.id === id)).filter(Boolean).slice(0, MAX_SEATS) as PickerModel[]
          if (seated.length) { setMasters(m => (m.length ? m : seated)); return }
        }
        const pick = rows.find(r => r.model_name === DEFAULT_MASTER) ?? FALLBACK_MASTERS.map(n => rows.find(r => r.model_name === n)).find(Boolean) ?? rows[0]
        if (pick) setMasters(m => (m.length ? m : [pick as PickerModel]))
      })
  }, [])


  /** What identifies this consultation, per temple: birth(s), a stick
   *  number, or birth + wishes. Sent to both the chart and reading routes. */
  const subject = (n?: number) =>
    isQian(temple) ? { temple, n: n ?? stick?.n, ask, name: bing.name.trim(), city: bing.city.trim(), ...(bing.withBirth ? { birth } : {}), ...(temple === 'guanyin' ? { edition } : {}) }
    : temple === 'tarot' ? { temple, spread, picks: picksRef.current, ask: ask.trim(), ...typeSubject }
    : temple === 'xingming' ? { temple, surname: surname.replace(/\s/g, ''), given: given.replace(/\s/g, ''), gender: birth.gender }
    : temple === 'cezi' ? { temple, ch: ch.trim(), ask }
    : temple === 'jiemeng' ? { temple, dream: dream.trim(), ask, lang }
    // 孫子兵法: `lang` is the language of the free translations.
    : temple === 'sunzi' ? { temple, situation: situation.trim(), ask: ask.trim(), lang, ...typeSubject }
    : temple === 'cookie' ? { temple, food: food.trim(), mealAt, ask: ask.trim(), lang }
    : temple === 'yixue' ? {
        temple, mode: yixueMode,
        ...(yixueMode === 'cast' ? { ask: ask.trim(), lines: castRef.current.values,
          ...(castRef.current.coins.length === 6 ? { coins: castRef.current.coins } : {}) }
          : yixueMode === 'lookup' ? { n: n ?? lookupN } : {}),
      }
    : temple === 'simianfo' ? { temple, birth, wishes }
    : temple === 'navagraha' ? { temple, birth, place }
    // 九星気学: the visitor's local date, so the boards are this year's and month's where they are.
    : temple === 'kyusei' ? { temple, birth, today: kyToday }
    : temple === 'sukuyo' ? { temple, birth, today: kyToday, ...(partnerDate ? { partner: partnerDate } : {}) }
    : temple === 'zhanxing' ? {
        temple, birth, place, mode: astroMode,
        ...(astroMode === 'synastry' ? { birth2, place2 } : {}),
        ...(astroMode === 'year' ? { year: srYear } : {}),
      }
    : { temple, birth, ...(temple === 'yuelao' ? { birth2, ...typeSubject } : {}) }

  // The visitor's own birthday, filled in only when they press 「填入我的生日」
  // (owner, Oct 1: "not auto fill since other people will see their
  // birthday if they watch you use the website"). 占星 used to restore it on
  // load from this browser's copy; now the copy, like the saved profile, waits
  // for the button. Gender and city come from the browser's copy only when
  // it is the same birthday.
  const myBirth = useMyBirth(TAKES_BIRTH(temple))
  const fillBirth = (set: (fn: (b: any) => any) => void, allowUnknown: boolean) => () => {
    const v = myBirth
    if (!v) return
    set(b => ({
      ...b, y: v.y, m: v.m, d: v.d,
      // A room that needs the hour keeps its own when the saved one is unknown.
      ...(v.hourUnknown && !allowUnknown ? {} : { h: v.h, mi: v.mi, hourUnknown: v.hourUnknown }),
      ...(v.gender ? { gender: v.gender } : {}),
    }))
    if (v.place && (temple === 'zhanxing' || temple === 'navagraha') && placesFor(lang).some(p => p.key === v.place)) setPlace(v.place)
  }

  const enter = async (n?: number): Promise<boolean> => {
    if (questionRequired && !input.trim()) return false
    if (temple === 'yixue') {
      if (yixueEntryPending.current) return false
      yixueEntryPending.current = true
      setYixueEntryBusy(true)
    }
    if (enteringRef.current) return false
    enteringRef.current = true
    setEntering(true)
    clearErr()
    refreshToken.current++
    if (temple === 'zhanxing') {
      try { localStorage.setItem(REMEMBER_KEY, JSON.stringify({ ...birth, place })) } catch { /* ignore */ }
    }
    try {
      const requestSubject = subject(n)
      // The routes check the same things; checking here first keeps the
      // message next to the form and in the visitor's language.
      const problem = subjectProblem(temple, requestSubject, astroMode)
      if (problem) throw new CodedError(problem, problem)
      const res = await fetch('/api/xtell/chart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestSubject),
      })
      const d = await res.json()
      if (!res.ok) throw new CodedError(d?.error ?? 'failed', d?.code)
      // Details edited after a conversation make a new visit: its thread
      // starts empty rather than continuing the old chart's.
      if (readingId && typeof d.readingId === 'string' && d.readingId !== readingId) setTurns([])
      setSavedProblem(null)
      setCheck('ok')
      // A reopened visit that was edited and cast again is a new visit: the
      // address follows it (a fresh visit's address is left as it was).
      if (typeof d.readingId === 'string' && new URLSearchParams(window.location.search).get('reading')) setReadingParam(d.readingId)
      if (temple === 'yixue') yixueSubject.current = requestSubject
      setChart(d.chart)
      setMatch(d.match ?? null)
      setYear(d.year ?? null)
      setBazi(d.bazi ?? null)
      setChenggu(d.chenggu ?? null)
      setReadingId(typeof d.readingId === 'string' ? d.readingId : null)
      setEntered(true)
      // The guide's suggestion has been used; a reload now reopens the visit.
      const store = sessionStore()
      if (store) clearHandoff(store)
      // 月老廟: the scores land free and instantly, so the only thing left to
      // ask is what they mean. Write the question for them but do NOT send it
      // — sending spends credits, and that stays a click the visitor makes.
      if (temple === 'yuelao') setInput(prev => prev || t('xtell.he.ask'))
      return true
    } catch (e: any) { fail(String(e?.message ?? e), e?.code); if (isQian(temple)) setRitualBoth(jiao ? 'drawn' : 'idle'); if (temple === 'tarot') picksRef.current = null; return false }
    finally {
      enteringRef.current = false
      setEntering(false)
      if (temple === 'yixue') { yixueEntryPending.current = false; setYixueEntryBusy(false) }
    }
  }

  // 易學堂's cast: one click, three coins, one line, bottom up. The sixth
  // line opens the hall. The browser's crypto source picks the faces, the
  // same as the 籤 tube: nobody, including us, chooses the hexagram.
  const enterCast = async () => {
    if (yixueEntryPending.current) return
    setCastEntering(true); setCastFailed(false)
    const ok = await enter()
    setCastEntering(false)
    if (!ok) setCastFailed(true)
  }
  const throwOnce = () => {
    const c = castRef.current
    if (yixueEntryPending.current || c.values.length >= 6 || !ask.trim()) return
    const faces = throwCoins(cryptoRand)
    const next = { values: [...c.values, valueOf(faces)], coins: [...c.coins, faces] }
    castRef.current = next; setCast(next); clearErr()
    if (next.values.length === 6) void enterCast()
  }
  const enterManualCast = (values: LineValue[]) => {
    if (yixueEntryPending.current || !ask.trim() || !validLines(values)) return
    const next = { values: [...values], coins: [] as Coin[][] }
    castRef.current = next; setCast(next)
    void enterCast()
  }
  const chooseCastMethod = (method: 'coins' | 'manual') => {
    if (yixueEntryPending.current || method === castMethod) return
    const empty = { values: [] as LineValue[], coins: [] as Coin[][] }
    castRef.current = empty; setCast(empty); setCastFailed(false); clearErr()
    setCastMethod(method)
  }
  const pickHexagram = (n: number) => {
    if (yixueEntryPending.current) return
    setLookupN(n); void enter(n)
  }

  // The ritual. Draw a stick, throw the blocks; a 聖筊 confirms and opens
  // the hall, anything else sends the visitor back to the tube. Randomness is
  // the browser's crypto source — nobody, including us, picks the stick.
  //
  // The ritual state lives in refs and is mirrored into React state for
  // rendering: two quick throws inside one render would otherwise both read
  // an empty `throws` and the count could never reach three (found in the
  // first browser test — a fast clicker was stuck at 1/3 forever).
  const stickRef = useRef<{ n: number; throws: Jiao[] } | null>(init.n ? { n: init.n, throws: ['聖筊', '聖筊', '聖筊'] } : null)
  const ritualRef = useRef<'idle' | 'drawn' | 'rejected' | 'confirmed'>(initial && init.n ? 'confirmed' : 'idle')
  const setRitualBoth = (r: 'idle' | 'drawn' | 'rejected' | 'confirmed') => { ritualRef.current = r; setRitual(r) }
  const draw = () => {
    const s = { n: drawQian(cryptoRand, temple === 'mazu' ? QIAN_COUNTS.mazu : temple === 'guanyin' ? QIAN_COUNTS.guanyin : QIAN_COUNTS.guandi), throws: [] as Jiao[] }
    stickRef.current = s; setStick(s); clearErr()
    // 元三大師's set: the stick is the answer; nothing to throw.
    if (!jiao) { setRitualBoth('confirmed'); void enter(s.n); return }
    setRitualBoth('drawn')
  }
  // 塔羅: shuffle and deal in the browser, then lay the cards.
  const dealCards = () => {
    if (enteringRef.current) return
    picksRef.current = drawTarot(cryptoRand, SPREADS[spread].length)
    void enter()
  }
  const throwBlocks = () => {
    const s = stickRef.current
    if (!s || ritualRef.current !== 'drawn') return
    const j = throwJiao(cryptoRand)
    const next = { ...s, throws: [...s.throws, j] }
    stickRef.current = next; setStick(next)
    if (j !== '聖筊') setRitualBoth('rejected')
    else if (next.throws.length >= CONFIRM_THROWS) { setRitualBoth('confirmed'); void enter(next.n) }
  }

  // 修改資料 (audit, product): back to the filled form. Casting again makes a
  // new visit (the old one stays in history). A 籤 is drawn again, because
  // the stick was confirmed for what was said at the altar.
  const editDetails = () => {
    // Back at the form, the page is no longer that visit: the address says so
    // (owner, Sep 28), and a reload opens the form, not the old conversation.
    setReadingParam(null)
    refreshToken.current++
    clearErr(); setEntered(false)
    if (isQian(temple)) { stickRef.current = null; setStick(null); setRitualBoth('idle') }
    if (temple === 'tarot') picksRef.current = null
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const chip = (on: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: busy ? 'default' : 'pointer',
    border: '1px solid ' + (on ? 'var(--red)' : 'var(--border2)'), background: on ? 'var(--surface2)' : '#ffffff',
    color: on ? 'var(--red)' : 'var(--muted)', fontWeight: on ? 700 : 500,
  })

  /** One teacher's thread: the questions put to it (or that it answered after
   *  joining) and its own replies, never another teacher's. */
  const threadOf = (ts: Turn[], id: string) => {
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (let i = 0; i < ts.length; i++) {
      const tn = ts[i]
      if (tn.role === 'assistant') { if (tn.modelId === id) out.push({ role: 'assistant', content: tn.content }); continue }
      let answered = false
      for (let j = i + 1; j < ts.length && ts[j].role === 'assistant'; j++) if ((ts[j] as any).modelId === id) answered = true
      if (!tn.to || tn.to.includes(id) || answered) out.push({ role: 'user', content: tn.content })
    }
    return out
  }

  /** Ask one teacher one question and stream the reply into a new bubble.
   *  `history` is that teacher's thread before the question. */
  const askTeacher = async (m: PickerModel, q: string, qid: string, to: string[], seats: string[], history: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    const idx = pushAssistant(m)
    try {
      const res = await fetch('/api/xtell/reading', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(daily ? { temple: 'daily' } : temple === 'yixue' ? yixueSubject.current ?? subject() : subject()), question: q, modelId: m.id, history, readingId, qid, to, seats,
          // 解夢: the line numbers shown, used only when the visit was not saved.
          ...(temple === 'jiemeng' ? { entries: (Array.isArray(chart?.entries) ? chart.entries : []).map((e: any) => e.id) } : {}),
          // 孫子兵法: the same, the line numbers shown.
          ...(temple === 'sunzi' ? { lines: (Array.isArray(chart?.lines) ? chart.lines : []).map((l: any) => l.id) } : {}),
          search: optsOf(m).search && searchable(m),
          thinking: optsOf(m).thinking,
          lang,
        }),
      })
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}))
        throw new CodedError(d?.error ?? `HTTP ${res.status}`, d?.code)
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const events = buf.split('\n\n'); buf = events.pop() ?? ''
        for (const ev of events) {
          const type = ev.match(/^event: (\w+)/m)?.[1]
          const data = ev.match(/^data: (.*)$/m)?.[1]
          if (!type || !data) continue
          const j = JSON.parse(data)
          if (type === 'delta') appendAssistant(idx, j.text)
          if (type === 'done') doneAssistant(idx, j.cost ?? 0)
          if (type === 'error') { fail(j.message ?? 'error', typeof j.code === 'string' ? j.code : null); doneAssistant(idx, 0) }
        }
      }
    } catch (e: any) { fail(String(e?.message ?? e), e?.code); doneAssistant(idx, 0) }
  }

  /** A signed-out visitor sees the chart for free; a question to a teacher
   *  costs credits, so that is where sign-in is asked. The dialog can be
   *  closed: the chart stays on screen, and the question in the box. */
  const signedIn = async () => {
    const { data: { session } } = await createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!).auth.getSession()
    if (!session) showSignIn()
    return !!session
  }

  const send = async (fromButton = false) => {
    // Chart rooms allow a general reading. Teacher conversations require an
    // actual question; neither an empty click nor Enter may spend credits.
    const typed = input.trim()
    if ((!typed && (questionRequired || !fromButton)) || busy || joining.length > 0 || masters.length === 0 || unverified || savedProblem) return
    if (!(await signedIn())) return
    const q = typed || t('xtell.question.general')
    const to = recipients.map(m => m.id), seats = masters.map(m => m.id)
    // One id per question: every master's request carries it, the server
    // stores the question once (xtell_append_turns dedupes on it).
    const qid = crypto.randomUUID()
    setInput(''); setBusy(true); clearErr()
    const before = turnsRef.current
    setTurns(ts => [...ts, { role: 'user', content: q, to, seats, qid }])
    // The chosen masters answer concurrently; each gets its own thread: the
    // questions put to it and its own replies, so two masters never see each
    // other's answers or a question they were not asked.
    await Promise.all(recipients.map(m => askTeacher(m, q, qid, to, seats, threadOf(before, m.id))))
    setBusy(false)
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }

  // 追加老師 (owner, Sep 28): a teacher who has not answered the latest
  // question answers it now, alone, under the same question, even while the
  // others are still thinking. The same qid, so the question is not stored
  // twice. Once asked it runs to the end: there is no cancelling mid-way.
  const lastUserIdx = (() => { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'user') return i; return -1 })()
  const lastUser = lastUserIdx >= 0 ? turns[lastUserIdx] as Extract<Turn, { role: 'user' }> : null
  const answeredLast = new Set(turns.slice(lastUserIdx + 1).map(tn => (tn as any).modelId as string).filter(Boolean))
  const canJoin = !!lastUser?.qid && !unverified && !savedProblem
  const join = async (m: PickerModel) => {
    const ts = turnsRef.current
    let at = -1
    for (let i = ts.length - 1; i >= 0; i--) if (ts[i].role === 'user') { at = i; break }
    const u = at >= 0 ? ts[at] as Extract<Turn, { role: 'user' }> : null
    if (!u?.qid || joining.includes(m.id) || ts.slice(at + 1).some(tn => (tn as any).modelId === m.id)) return
    if (!(await signedIn())) return
    setJoining(js => [...js, m.id]); clearErr()
    await askTeacher(m, u.content, u.qid, u.to ?? [], u.seats ?? masters.map(x => x.id), threadOf(ts.slice(0, at), m.id))
    setJoining(js => js.filter(x => x !== m.id))
  }

  // Refs so concurrent streams append into the right bubbles without racing
  // React state reads.
  const turnsRef = useRef<Turn[]>([])
  useEffect(() => { turnsRef.current = turns }, [turns])
  const pushAssistant = (m: PickerModel) => {
    let idx = -1
    setTurns(ts => { idx = ts.length; return [...ts, { role: 'assistant', content: '', modelId: m.id, name: m.display_name, provider: m.provider }] })
    return () => idx
  }
  const appendAssistant = (idxOf: () => number, text: string) =>
    setTurns(ts => ts.map((tn, i) => (i === idxOf() ? { ...tn, content: (tn as any).content + text } : tn)))
  const doneAssistant = (idxOf: () => number, cost: number) =>
    setTurns(ts => ts.map((tn, i) => (i === idxOf() ? { ...tn, cost } : tn)))

  /** Group the flat transcript into rounds: one user turn plus every reply
   *  that followed it, so replies render as columns. */
  const rounds = (ts: Turn[]) => {
    const out: Array<{ user: Turn | null; replies: Turn[] }> = []
    for (const tn of ts) {
      if (tn.role === 'user') out.push({ user: tn, replies: [] })
      else {
        if (out.length === 0) out.push({ user: null, replies: [] })
        out[out.length - 1].replies.push(tn)
      }
    }
    return out
  }

  // Every model that has answered in this room (seated or since dismissed),
  // with its summed cost — the tabs of the 分頁 layout.
  const replyModels = (() => {
    const seen = new Map<string, { id: string; name: string; provider: string; cost: number }>()
    for (const m of masters) seen.set(m.id, { id: m.id, name: m.display_name, provider: m.provider, cost: 0 })
    for (const tn of turns) if (tn.role === 'assistant') {
      const cur = seen.get(tn.modelId) ?? { id: tn.modelId, name: tn.name, provider: tn.provider, cost: 0 }
      cur.cost += tn.cost ?? 0
      seen.set(tn.modelId, cur)
    }
    return [...seen.values()]
  })()
  const activeTab = replyModels.some(m => m.id === tab) ? tab : (replyModels[0]?.id ?? null)
  const nameOf = (id: string) => masters.find(m => m.id === id)?.display_name ?? replyModels.find(m => m.id === id)?.name ?? catalog.find(m => m.id === id)?.display_name ?? null
  /** Put to only some of the table: the names it went to, else null. */
  const toOnly = (tn: Turn, replies: Turn[] = []) => {
    if (tn.role !== 'user' || !tn.to || !tn.seats) return null
    // A teacher who joined later answered it too (追加老師).
    const who = [...new Set([...tn.to, ...replies.map(r => (r as any).modelId as string).filter(Boolean)])]
    return who.length < tn.seats.length ? who.map(nameOf).filter(Boolean).join('、') : null
  }

  const sel = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 13 }

  return (
    // On www the room keeps a 980 measure inside the ModelXD arena. The
    // standalone room uses the page's full width, the 1216 px of the top bar
    // (owner, Sep 27: four teachers overflowed 980 px with space to spare on
    // both sides).
    <div className={standalone ? "xtell-room" : undefined} data-entered={entered || undefined} style={{ maxWidth: standalone ? 1216 : 980 }}>
      {/* On the standalone site the header's 探索殿堂 link is the way back
          (owner, Sep 24: no second back link). www's /xtell keeps it — the
          ModelXD sidebar has no route to the street. */}
      {!standalone && (
        <button onClick={onBack} style={{ border: 'none', background: 'none', color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer', padding: 0, marginBottom: 14 }}>
          ← {t('xtell.back')}
        </button>
      )}
      {standalone ? <>
        <header className="xtell-room-header">
          <TempleArtwork temple={temple} kind="icon" className="xtell-room-artwork" />
          <div><p className="xtell-eyebrow">{t('xtell.site.street')}</p><h1>{t(`xtell.site.focus.${temple}.name`)}</h1><p>{t(`xtell.site.focus.${temple}.description`)}</p></div>
        </header>
      </> : <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 14px' }}>{t(`xtell.${temple}.name`)}</h2>}

      {!entered ? (<>
        <div className={standalone ? "xtell-entry-form" : undefined} aria-busy={entering || undefined} style={{ ...card, padding: '18px 20px', position: 'relative' }}>
          {entering && <span className="xtell-entering-bar" aria-hidden="true" />}
          {carried?.question && <p className="xtell-carried" role="note">{t('xtell.as.carried').replace('{q}', carried.question)}</p>}
          {/* 占星塔 picks the reading BEFORE the form, because 配對 needs a
              second person and 流年 needs a year. */}
          {temple === 'zhanxing' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {ASTRO_MODES.map(m => {
                const on = astroMode === m
                return (
                  <button key={m} onClick={() => setAstroMode(m)} style={{
                    padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: on ? 700 : 400,
                    border: `1px solid ${on ? 'var(--red)' : 'var(--border2)'}`,
                    background: on ? 'var(--red)' : 'transparent', color: on ? '#fff' : 'var(--muted)',
                  }}>{t(`xtell.astro.${m}`)}</button>
                )
              })}
              <span style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6, marginTop: 2 }}>
                {t(`xtell.astro.${astroMode}.hint`)}
              </span>
              {/* 12:00 and 台北 are prefilled so the form is never empty; a
                  visitor who changes only the date would otherwise get a
                  precise Ascendant for a time they never gave (Codex QA). */}
              <span style={{ flexBasis: '100%', fontSize: 12, color: 'var(--white)', lineHeight: 1.6 }}>
                {t('xtell.astro.confirm')}
              </span>
            </div>
          )}
          {temple === 'yixue' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {YIXUE_MODES.filter(m => m !== 'cast').map(m => {
                const on = yixueMode === m
                return (
                  <button key={m} type="button" aria-pressed={on} disabled={yixueEntryBusy}
                    onClick={() => { if (!yixueEntryPending.current) setYixueMode(m) }} style={{
                    padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: on ? 700 : 400,
                    border: `1px solid ${on ? 'var(--red)' : 'var(--border2)'}`,
                    background: on ? 'var(--red)' : 'transparent', color: on ? '#fff' : 'var(--muted)',
                  }}>{t(`xtell.yixue.mode.${m}`)}</button>
                )
              })}
              <details style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--muted)' }}>
                <summary style={{ cursor: 'pointer', padding: '7px 0' }}>{t('xtell.yixue.practice')}</summary>
                <button type="button" disabled={yixueEntryBusy} aria-pressed={yixueMode === 'cast'}
                  onClick={() => { if (!yixueEntryPending.current) setYixueMode('cast') }}
                  style={{ padding: '7px 12px', border: '1px solid var(--border2)', borderRadius: 8, background: 'transparent', color: 'var(--white)', font: 'inherit', cursor: 'pointer' }}>
                  {t('xtell.yixue.mode.cast')}
                </button>
              </details>
              <span style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6, marginTop: 2 }}>
                {t(`xtell.yixue.mode.${yixueMode}.hint`)}
              </span>
            </div>
          )}
          {temple === 'yixue' ? (
            yixueMode === 'cast'
              ? <div style={{ display: 'grid', gap: 14 }}>
                  <div role="group" aria-label={t('xtell.yixue.practice')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(['coins', 'manual'] as const).map(method => <button key={method} type="button" disabled={yixueEntryBusy} aria-pressed={castMethod === method}
                      onClick={() => chooseCastMethod(method)} style={{ padding: '7px 12px', border: '1px solid var(--border2)', borderRadius: 8, font: 'inherit', fontSize: 12.5, background: castMethod === method ? 'var(--surface2)' : 'transparent', color: 'var(--white)', cursor: yixueEntryBusy ? 'wait' : 'pointer' }}>
                      {t(`xtell.yixue.method.${method}`)}
                    </button>)}
                  </div>
                  {castMethod === 'manual'
                    ? <YixueManualCast ask={ask} setAsk={setAsk} values={manualLines} onChange={setManualLines} onSubmit={enterManualCast} disabled={yixueEntryBusy} sel={sel} />
                    : <YixueRitual ask={ask} setAsk={setAsk} values={cast.values} coins={cast.coins} onThrow={throwOnce}
                        onRetry={() => void enterCast()} entering={castEntering} failed={castFailed} sel={sel} />}
                </div>
              : yixueMode === 'lookup' ? <YixuePicker onPick={pickHexagram} picked={lookupN} disabled={yixueEntryBusy} />
              : <YixueQuestion value={input} onChange={setInput} disabled={yixueEntryBusy} />
          ) : temple === 'tarot' ? (
            <TarotPanel ask={ask} setAsk={setAsk} spread={spread} setSpread={setSpread} onDeal={dealCards} entering={entering} sel={sel}
              extra={<PersonalityAttach saved={savedType} on={withType} setOn={setWithType} />} />
          ) : isQian(temple) ? (
            <RitualPanel ask={ask} setAsk={setAsk} stick={stick} ritual={ritual} onDraw={draw} onThrow={throwBlocks} jiao={jiao}
              bing={bing} setBing={setBing} birth={birth} setBirth={setBirth} sel={sel} onFillBirth={myBirth ? fillBirth(setBirth, true) : undefined} />
          ) : temple === 'xingming' ? (
            <NameForm surname={surname} given={given} gender={birth.gender}
              onSurname={setSurname} onGiven={setGiven} onGender={g => setBirth(b => ({ ...b, gender: g }))} sel={sel}
              surnameAria={fieldAria('surname')} givenAria={fieldAria('given')} />
          ) : temple === 'cezi' ? (
            <CeziForm ch={ch} setCh={setCh} ask={ask} setAsk={setAsk} sel={sel} charAria={fieldAria('char')} />
          ) : temple === 'cookie' ? (
            <CookieForm food={food} setFood={setFood} mealAt={mealAt} setMealAt={setMealAt} ask={ask} setAsk={setAsk} sel={sel} foodAria={fieldAria('food')} mealAria={fieldAria('mealAt')} />
          ) : temple === 'jiemeng' ? (
            <DreamForm dream={dream} setDream={setDream} ask={ask} setAsk={setAsk} sel={sel} dreamAria={fieldAria('dream')} />
          ) : temple === 'sunzi' ? (
            <>
              <SunziForm situation={situation} setSituation={setSituation} ask={ask} setAsk={setAsk} sel={sel} situationAria={fieldAria('situation')} />
              <PersonalityAttach saved={savedType} on={withType} setOn={setWithType} />
            </>
          ) : temple === 'yuelao' || (temple === 'zhanxing' && astroMode === 'synastry') ? (
            <>
              <BirthRow label={t('xtell.person1')} value={birth} onChange={setBirth} sel={sel} aria={fieldAria('birth')} onFill={myBirth ? fillBirth(setBirth, true) : undefined} />
              {temple === 'zhanxing' && <PlaceRow label={t('xtell.person1')} value={place} onChange={setPlace} sel={sel} aria={fieldAria('place')} />}
              <div style={{ height: 12 }} />
              <BirthRow label={t('xtell.person2')} value={birth2} onChange={setBirth2} sel={sel} aria={fieldAria('birth2')} />
              {temple === 'zhanxing' && <PlaceRow label={t('xtell.person2')} value={place2} onChange={setPlace2} sel={sel} aria={fieldAria('place2')} />}
              {temple === 'yuelao' && <PersonalityAttach saved={savedType} on={withType} setOn={setWithType} partner={partnerType} setPartner={setPartnerType} />}
            </>
          ) : (
            <BirthRow value={birth} onChange={setBirth} sel={sel} allowUnknown={!HOUR_REQUIRED.includes(temple)} aria={fieldAria('birth')}
              onFill={myBirth ? fillBirth(setBirth, !HOUR_REQUIRED.includes(temple)) : undefined} />
          )}
          {temple === 'simianfo' && <WishForm wishes={wishes} setWishes={setWishes} aria={fieldAria('wishes')} />}
          {temple === 'sukuyo' && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label htmlFor="xtell-sk-partner" style={{ fontSize: 12.5, fontWeight: 700 }}>{t('xtell.sk.partner')}</label>
              <input id="xtell-sk-partner" type="date" value={partnerDate} min="1900-01-01" max={kyToday} onChange={e => setPartnerDate(e.target.value)} style={sel} />
              {partnerDate && <button type="button" onClick={() => setPartnerDate('')} style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', padding: 0 }}>{t('xtell.sk.partnerClear')}</button>}
              <span style={{ fontSize: 11, color: 'var(--muted2)', flex: '1 1 100%' }}>{t('xtell.sk.partnerNote')}</span>
            </div>
          )}
          {temple === 'navagraha' && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }} aria-hidden="true">{t('xtell.place')}</span>
              <select aria-label={t('xtell.place')} aria-invalid={fieldAria('place').invalid || undefined} aria-describedby={fieldAria('place').describedBy} style={sel} value={place} onChange={e => setPlace(e.target.value)}>
                {placesFor(lang).map(p => <option key={p.key} value={p.key}>{placeLabel(p, lang)}</option>)}
              </select>
              <span style={{ fontSize: 11, color: 'var(--muted2)', flex: 1, minWidth: 240 }}>{t('xtell.place.note')}</span>
            </div>
          )}
          {temple === 'zhanxing' && astroMode !== 'synastry' && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }} aria-hidden="true">{t('xtell.place')}</span>
              <select aria-label={t('xtell.place')} aria-invalid={fieldAria('place').invalid || undefined} aria-describedby={fieldAria('place').describedBy} style={sel} value={place} onChange={e => setPlace(e.target.value)}>
                {placesFor(lang).map(p => <option key={p.key} value={p.key}>{placeLabel(p, lang)}</option>)}
              </select>
              {astroMode === 'year' && (
                <>
                  <span style={{ fontSize: 12.5, fontWeight: 700, marginLeft: 8 }} aria-hidden="true">{t('xtell.astro.year.pick')}</span>
                  <select aria-label={t('xtell.astro.year.label')} style={sel} value={srYear} onChange={e => setSrYear(+e.target.value)}>
                    {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 3 + i).map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </>
              )}
              <span style={{ fontSize: 11, color: 'var(--muted2)', flex: 1, minWidth: 220 }}>{t('xtell.place.note')}</span>
            </div>
          )}
          {!isQian(temple) && temple !== 'tarot' && !(temple === 'yixue' && yixueMode !== 'ask') && (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
              {entering
                // The two entries that wait on a quick model say how long
                // (Sep 29); the others are computed here in a moment.
                ? temple === 'jiemeng' || temple === 'sunzi' || temple === 'cookie'
                  ? <div style={{ flex: 1, minWidth: 0, marginRight: 14 }}><WaitBar seconds={temple === 'cookie' ? WAIT_SECONDS.cookie : temple === 'sunzi' ? WAIT_SECONDS.sunzi : WAIT_SECONDS.dream} label={t(temple === 'jiemeng' ? 'xtell.jiemeng.looking' : temple === 'sunzi' ? 'xtell.sunzi.looking' : 'xtell.cookie.cracking')} /></div>
                  : <div role="status" aria-live="polite" style={{ fontSize: 12, color: 'var(--muted)' }}>{t('xtell.entering.note')}</div>
                : <div style={{ fontSize: 11, color: 'var(--muted2)' }}>{temple === 'xingming' || temple === 'cezi' || temple === 'yixue' || temple === 'jiemeng' || temple === 'sunzi' || temple === 'cookie' ? '' : t('xtell.solar.note')}</div>}
              {/* The wait bar takes the whole row beside the button. */}
              {!(entering && (temple === 'jiemeng' || temple === 'sunzi' || temple === 'cookie')) && <span style={{ flex: 1 }} />}
              <button onClick={() => void enter()} disabled={entering || (temple === 'yixue' && (yixueEntryBusy || !input.trim()))} aria-busy={entering || undefined} style={{
                padding: '10px 26px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', minWidth: 112,
                fontWeight: 700, fontSize: 13.5, cursor: entering ? 'wait' : questionRequired && (!input.trim() || yixueEntryBusy) ? 'not-allowed' : 'pointer', opacity: !entering && questionRequired && (!input.trim() || yixueEntryBusy) ? 0.5 : 1,
              }}>{entering
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="xtell-think is-light" aria-hidden="true"><i /><i /><i /></span>{t('xtell.entering')}</span>
                : t(temple === 'yixue' ? 'xtell.yixue.enter' : temple === 'cookie' ? 'xtell.cookie.crack' : 'xtell.enter')}</button>
            </div>
          )}
          {/* The price, and how a meal is told apart (a tester, Sep 29: the
              hours mealOf uses), under the button at full width. */}
          {temple === 'cookie' && <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.7 }}>{t('xtell.cookie.price')}<br />{t('xtell.cookie.sameMeal')}</p>}
          {errShown && <div id={errId} role="alert" style={{ marginTop: 10, color: 'var(--red)', fontSize: 12.5 }}>⚠ {errShown}</div>}
        </div>
        {/* This temple's saved visits (owner, Sep 24: history in each
            temple, not only on the account page), in their own card under
            the form (owner, Sep 27). Continue reopens the room in place with
            chart and conversation. */}
        {onResume && <TempleHistory temple={temple} onResume={onResume} />}
      </>) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* The way back to the form, first thing in the room, with what
              this visit was cast from (owner, Sep 27: "how do I go back?";
              it used to sit in the composer at the foot of the page). */}
          <div className="xtell-subject" style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--muted)', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
            {daily
              ? <button type="button" onClick={onBack} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--red)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>← {t('xtell.dy.back')}</button>
              // 「返回」, not 「修改資料」 (owner, Sep 28): it goes back to the form.
              : <button type="button" onClick={editDetails} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--red)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>← {t('xtell.goBack')}</button>}
            {!daily && temple !== 'yixue' && (() => {
              const summary = subjectSummary(t, temple, subject(), lang)
              return summary ? <span style={{ minWidth: 0 }}>{summary}</span> : null
            })()}
          </div>

          {/* Teachers (owner, Sep 27): the seats at a fixed width, then
              再請一位老師 beside them, then the reply layout; no preset row.
              The settings cards sit in the SAME columns under their chips
              (owner, Sep 24), and both rows share one scroll frame, so on a
              phone the seats drag sideways together instead of wrapping.
              Clicking a name opens the picker to REPLACE that seat; ⚙ opens
              every seat's settings; ✕ removes a seat while another remains. */}
          {(() => {
            const cols = `repeat(${masters.length}, minmax(200px, 264px))`
            const seatChars = turns.reduce((n, tn) => n + tn.content.length, 0) + input.length
            return (
              <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, flexShrink: 0 }}>
                  {masters.map((m, i) => {
                    const color = SLOT_COLORS[i]
                    return (
                      <div key={m.id} className="xtell-seat" data-open={optsOpen || undefined}
                        style={optsOpen ? { borderColor: color + '80', boxShadow: `inset 3px 0 0 ${color}, 0 1px 2px rgba(60, 40, 20, .05)` } : undefined}>
                        <span className="xtell-seat-logo" aria-hidden="true"><ProviderLogo provider={m.provider} size={18} /></span>
                        <button type="button" className="xtell-seat-main" title={t('xtell.changemaster')} aria-label={`${t('xtell.changemaster')}: ${m.display_name}`} onClick={() => setPicker({ replace: m.id })}>
                          <span className="xtell-seat-name"><span>{m.display_name}</span><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                        </button>
                        <span className="xtell-seat-acts">
                        <button type="button" className="xtell-seat-act" title={t('xtell.opts.title')} aria-label={`${t('xtell.opts.title')}: ${m.display_name}`} aria-expanded={optsOpen} onClick={() => setOptsOpen(v => !v)}
                          style={optsOpen ? { color, background: color + '14' } : undefined}>
                          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2.5 4.5h11M2.5 11.5h11" /><circle cx="6" cy="4.5" r="1.7" fill="#fff" /><circle cx="10.5" cy="11.5" r="1.7" fill="#fff" /></svg>
                        </button>
                        {masters.length > 1 && (
                          <button type="button" className="xtell-seat-act" title={t('xtell.site.remove')} aria-label={`${t('xtell.site.remove')} ${m.display_name}`} onClick={() => setMasters(ms => ms.filter(x => x.id !== m.id))}>
                            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M3 3l6 6M9 3l-6 6" /></svg>
                          </button>
                        )}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {masters.length < MAX_SEATS && (
                  <button type="button" className="xtell-seat-add" onClick={() => setPicker({ replace: null })}>
                    <span className="xtell-seat-plus" aria-hidden="true">＋</span>{t('xtell.addmaster')}
                  </button>
                )}
                <span style={{ flex: 1 }} />
                {(masters.length > 1 || replyModels.length > 1) && (
                  <span style={{ flexShrink: 0, display: 'inline-flex', border: '1px solid var(--border2)', borderRadius: 999, overflow: 'hidden', fontSize: 11.5 }}>
                    {(['columns', 'tabs'] as const).map(l => (
                      <button key={l} type="button" onClick={() => chooseLayout(l)} style={{
                        border: 'none', padding: '5px 11px', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: layout === l ? 700 : 500,
                        background: layout === l ? 'var(--surface2)' : 'transparent', color: layout === l ? 'var(--white)' : 'var(--muted)',
                      }}>{t(`xtell.layout.${l}`)}</button>
                    ))}
                  </span>
                )}
                </div>

                {/* Settings, XCreate's cards, one per column. A master with
                    nothing to set keeps its column with a dash, so the cards
                    stay under their chips. */}
                {optsOpen && (
                  <div style={{ marginTop: 8, border: '1px solid var(--border2)', borderRadius: 12, background: 'var(--surface)', padding: '10px 12px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <span style={{ ...mono, color: 'var(--muted2)' }}>{t('xtell.opts.title')}</span>
                      <span style={{ flex: 1 }} />
                      <button type="button" onClick={() => setOptsOpen(false)} style={{
                        padding: '5px 14px', borderRadius: 999, border: '1px solid var(--border2)', background: '#ffffff',
                        color: 'var(--white)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      }}>{t('xtell.opts.done')} ▴</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'start' }}>
                      {masters.map((m, i) => {
                        const color = SLOT_COLORS[i], levels = levelsOf(m), o = optsOf(m)
                        const groups = [levels.length > 0 ? 'think' : null, searchable(m) ? 'search' : null].filter(Boolean)
                        const isLast = (g: string) => groups[groups.length - 1] === g
                        return (
                          <div key={m.id} style={{ background: '#ffffff', border: `1px solid ${color}22`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, minWidth: 0 }}>
                              <ProviderLogo provider={m.provider} size={13} />
                              <span style={{ fontSize: 12, fontWeight: 700, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.display_name}</span>
                            </div>
                            {groups.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted2)' }}>—</div>}
                            {levels.length > 0 && (
                              <OptGroup label={t('xcreate.thinking')} last={isLast('think')}>
                                <OptPill color={color} active={o.thinking == null} onClick={() => setOpts(m, { thinking: null })}><span style={nowrap}>{t('xcreate.auto')}</span></OptPill>
                                {levels.map(l => (
                                  <OptPill key={l} color={color} active={o.thinking === l} onClick={() => setOpts(m, { thinking: l })}><span style={nowrap}>{thinkingLabel(l, t)}</span></OptPill>
                                ))}
                              </OptGroup>
                            )}
                            {searchable(m) && (
                              <OptGroup label={t('xcreate.websearch')} last={isLast('search')}>
                                <OptPill color={color} active={!o.search} onClick={() => setOpts(m, { search: false })}><span style={nowrap}>{t('xcreate.off')}</span></OptPill>
                                <OptPill color={color} active={o.search} onClick={() => setOpts(m, { search: true })}><span style={nowrap}>{t('xcreate.on')}</span></OptPill>
                              </OptGroup>
                            )}
                            {/* What these settings cost and how soon this
                                teacher starts, following the chosen level
                                (owner, Sep 27: here, not on the seat). */}
                            {(() => {
                              const usd = estimateReadingUsd(m, { thinking: o.thinking, search: o.search && searchable(m) }, seatChars, temple === 'yixue' ? EST_YIXUE_PROMPT_TOKENS : EST_PROMPT_TOKENS)
                              const secs = firstWord(m, o.thinking)
                              if (usd == null && !secs) return null
                              return (
                                <dl className="xtell-seat-stats">
                                  {usd != null && <div><dt>{t('xtell.seat.priceLabel')}</dt><dd>~{fmtUsdFor(usd, lang)}</dd></div>}
                                  {secs && <div title={t('xtell.seat.ttft.tip')}><dt>{t('xtell.seat.ttftLabel')}</dt><dd>~{secs} {t('xtell.seat.sec')}</dd></div>}
                                </dl>
                              )
                            })()}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {savedProblem && (
            <div role="alert" style={{ ...card, padding: '12px 14px', borderColor: 'var(--red)', display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>{t('xtell.saved.invalid').replace('{reason}', errorText(t, savedProblem, savedProblem))}</div>
              <div><button type="button" onClick={editDetails} style={{ padding: '7px 16px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>{t('xtell.edit')}</button></div>
            </div>
          )}

          {unverified && !savedProblem && (
            <div role={check === 'failed' ? 'alert' : 'status'} style={{ ...card, padding: '12px 14px', display: 'grid', gap: 10, ...(check === 'failed' ? { borderColor: 'var(--red)' } : {}) }}>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>{t(check === 'failed' ? 'xtell.saved.checkFailed' : 'xtell.saved.checking')}</div>
              {check === 'failed' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={refreshSaved} style={{ padding: '7px 16px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>{t('xtell.site.retry')}</button>
                  <button type="button" onClick={editDetails} style={{ padding: '7px 16px', borderRadius: 999, border: '1px solid var(--border2)', background: 'transparent', color: 'var(--white)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>{t('xtell.edit')}</button>
                </div>
              )}
            </div>
          )}


          {/* 月老廟's 合盤, above everything: it is free, it is computed, and it
              is what the two of them came to see. The reading interprets it. */}
          {match && !savedProblem && !unverified && <HeCard match={match} />}

          {/* 今日運勢 continued here: the day's reading in place of a chart. */}
          {daily && (
            <div className={standalone ? "xtell-chart" : undefined} style={{ ...card, padding: '14px 16px' }}>
              <DailyBoard row={daily} />
            </div>
          )}

          {/* The chart, always shown (owner, Sep 27: no 收起命盤). */}
          {chart && !savedProblem && (!unverified || isQian(temple)) && (
            <div className={standalone ? "xtell-chart" : undefined} style={{ ...card, padding: '14px 16px' }}>
              {/* Where a beginner starts, from the chart itself (日主, 命宮
                  and its stars, 上升 and the Moon's 宿). */}
              {(() => { const fact = chartFact(t, temple, chart, lang); return fact ? <p className="xtell-chart-fact">{fact}</p> : null })()}
              {temple === 'bazi' ? <><BaziBoard chart={chart} hourUnknown={!!birth.hourUnknown} />{/* 称骨 is unknown in Japan (a reviewer, Sep 29): no card on Japanese pages. */}{chenggu && lang !== 'ja' && <ChengguCard data={chenggu} disabled={busy} onAsk={question => {
                  setInput(question)
                  composerRef.current?.focus()
                  composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }} />}</>
                : temple === 'ziwei' ? <ZiweiBoard chart={chart} />
                : isQian(temple) ? <QianCard qian={chart} temple={temple} bazi={unverified ? null : bazi} year={unverified ? null : year} hourUnknown={bing.withBirth && !!birth.hourUnknown} />
                : temple === 'xingming' ? <NameBoard chart={chart} />
                : temple === 'cezi' ? <CeziBoard info={chart} ask={ask} />
                : temple === 'jiemeng' ? <DreamBoard chart={chart} />
                : temple === 'sunzi' ? <SunziBoard chart={chart} />
                : temple === 'tarot' ? <TarotBoard chart={chart} />
                : temple === 'cookie' ? <CookieBoard chart={chart} readingId={readingId}
                    onNote={(note, fortune) => setChart((c: any) => c?.fortune === fortune ? { ...c, note, notePending: false } : c)} />
                : temple === 'simianfo' ? <WishBoard chart={chart} wishes={wishes} year={year} hourUnknown={!!birth.hourUnknown} />
                : temple === 'navagraha' ? <NavagrahaBoard chart={chart} />
                : temple === 'kyusei' ? <KyuseiBoard chart={chart} />
                : temple === 'sukuyo' ? <SukuyoBoard chart={chart} />
                : temple === 'zhanxing' ? <ZhanxingBoard chart={chart} />
                : temple === 'yixue' ? <YixueBoard chart={chart} onExample={q => setInput(q)} />
                : (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div><div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.person1')}</div><BaziBoard chart={chart.a} hourUnknown={!!birth.hourUnknown} /></div>
                    <div><div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.person2')}</div><BaziBoard chart={chart.b} hourUnknown={!!birth2.hourUnknown} /></div>
                  </div>
                )}
            </div>
          )}

          {/* Conversation. Empty and without an intro line (解夢 before its
              first question), it takes no room. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: turns.length === 0 && (temple === 'jiemeng' || temple === 'sunzi' || daily) ? 0 : 120 }}>
            {turns.length === 0 && !savedProblem && !unverified && temple !== 'jiemeng' && temple !== 'sunzi' && !daily && (
              <div style={{ padding: '16px 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.7 }}>
                {t(temple === 'yixue' ? `xtell.yixue.intro.${chart?.mode ?? 'ask'}`
                  : temple === 'zhanxing' && chart?.natal?.hourUnknown ? 'xtell.zhanxing.intro.unknown' : `xtell.${temple}.intro`)}
              </div>
            )}
            {initial && turns.length > 0 && (
              <div style={{ padding: '10px 18px', fontSize: 12.5, color: 'var(--muted2)' }}>{t('xtell.saved.resumed')}</div>
            )}
            {/* Rounds: a user bubble, then every seated master's reply — side
                by side (scrolling past two) or one at a time behind the tabs.
                Nobody has to pick one to continue (owner, Sep 24): every seat
                keeps its own thread; 只留這位老師 is there for whoever wants to
                stop paying for the rest. Past rounds keep their replies. */}
            {layout === 'tabs' && replyModels.length > 1 && (
              <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)', padding: '6px 0' }}>
                {replyModels.map(m => (
                  <button key={m.id} role="tab" aria-selected={activeTab === m.id} onClick={() => setTab(m.id)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, fontSize: 12.5, cursor: 'pointer',
                    border: '1px solid ' + (activeTab === m.id ? 'var(--red)' : 'var(--border2)'),
                    background: activeTab === m.id ? 'var(--red-dim, var(--surface2))' : '#ffffff',
                    color: activeTab === m.id ? 'var(--red)' : 'var(--muted)', fontWeight: activeTab === m.id ? 700 : 500,
                  }}>
                    <ProviderLogo provider={m.provider} size={13} />
                    {m.name}
                    {m.cost > 0 && <span style={{ ...mono, fontSize: 9.5 }}>{fmtUsdFor(m.cost, lang)}</span>}
                  </button>
                ))}
              </div>
            )}
            {rounds(turns).map((round, ri) => {
              // 分頁 shows one master's own thread: a question put to others
              // only is not part of it.
              const u = round.user as any
              if (layout === 'tabs' && replyModels.length > 1 && u?.to && activeTab && !u.to.includes(activeTab)
                && !round.replies.some((r: any) => r.modelId === activeTab)) return null   // unless it joined (追加老師)
              const only = round.user ? toOnly(round.user, round.replies) : null
              return (
              <div key={ri} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {round.user && (
                  <div style={{ alignSelf: 'flex-end', maxWidth: '82%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {only && <span style={{ ...mono, fontSize: 11, color: 'var(--muted2)' }}>{t('xtell.ask.toLabel').replace('{names}', only)}</span>}
                    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 12, padding: '10px 14px', fontSize: 13.5, whiteSpace: 'pre-wrap' }}>
                      {round.user.content}
                    </div>
                  </div>
                )}
                {round.replies.length > 0 && (() => {
                  // 並排: one column per reply, at least 360 px each, the row
                  // scrolls sideways past two. 分頁: only the active master's.
                  const shown = layout === 'tabs' ? round.replies.filter((tn: any) => tn.modelId === activeTab) : round.replies
                  if (shown.length === 0) return null
                  return (
                  <div style={{ overflowX: layout === 'columns' ? 'auto' : 'visible', paddingBottom: layout === 'columns' && shown.length > 2 ? 6 : 0 }}>
                  <div className={standalone ? "xtell-replies" : undefined} style={{ display: 'grid', gridTemplateColumns: layout === 'columns' ? `repeat(${shown.length}, minmax(${shown.length > 1 ? 360 : 0}px, 1fr))` : 'minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
                    {shown.map((tn: any, j: number) => (
                      <div key={j} style={{ background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 12, padding: '12px 16px', fontSize: 14, lineHeight: 1.85, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <ProviderLogo provider={tn.provider} size={13} />
                          <span style={{ ...mono, color: 'var(--muted2)' }}>{tn.name}</span>
                          {typeof tn.cost === 'number' && tn.cost > 0 && (
                            // Credits are debited in whole cents (Math.round in the
                            // reading route, as on every surface), so a reply under
                            // half a cent shows its list cost but deducted nothing.
                            <span title={Math.round(tn.cost * 100) === 0 ? t('xtell.cost.subcent') : undefined}
                              style={{ ...mono, color: 'var(--muted2)', cursor: Math.round(tn.cost * 100) === 0 ? 'help' : undefined }}>· {fmtUsdFor(tn.cost, lang)}</span>
                          )}
                          <span style={{ flex: 1 }} />
                          {/* 分享 (owner, Sep 28): a picture of this reply's
                              opening, never the question or the birth. */}
                          {tn.content && !busy && (
                            <ShareButton spec={() => ({ icon: temple, link: temple, title: t(`xtell.site.focus.${temple}.name`),
                              kicker: t('xtell.share.by').replace('{name}', tn.name), body: shareExcerpt(tn.content), style: 'prose', name: `xtell-${temple}` })} />
                          )}
                          {masters.length > 1 && masters.some(m => m.id === tn.modelId) && (
                            <button type="button" onClick={() => askOnly(tn.modelId)} disabled={busy}
                              aria-label={`${t('xtell.ask.one')}: ${tn.name}`}
                              style={{ border: '1px solid var(--border2)', background: 'none', color: 'var(--muted)', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
                              {t('xtell.ask.one')}
                            </button>
                          )}
                          {masters.length > 1 && masters.some(m => m.id === tn.modelId) && (
                            <button onClick={() => !busy && setMasters(ms => ms.filter(x => x.id === tn.modelId))}
                              disabled={busy}
                              style={{ border: '1px solid var(--red)', background: 'none', color: 'var(--red)', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
                              {t('xtell.keep')}
                            </button>
                          )}
                        </div>
                        {/* Markdown, not pre-wrap. Models write 批文 with **bold**
                            and headings; rendering it raw printed the asterisks
                            at the reader. `markdown-body` + skipHtml is what
                            every other text surface here uses. */}
                        {tn.content
                          ? <div className="markdown-body" style={{ lineHeight: 1.85 }}><ReactMarkdown skipHtml remarkPlugins={REMARK_PLUGINS}>{tn.content}</ReactMarkdown></div>
                          : <Thinking name={tn.name} />}
                      </div>
                    ))}
                  </div>
                  </div>
                  )
                })()}
                {/* 追加老師: only under the latest question. A seated teacher who
                    has not answered it gets a button; or add a new one here. */}
                {ri === rounds(turns).length - 1 && round.user && canJoin && (() => {
                  const chars = turns.reduce((n, tn) => n + tn.content.length, 0)
                  const usdOf = (m: PickerModel) => estimateReadingUsd(m, { thinking: optsOf(m).thinking, search: optsOf(m).search && searchable(m) }, chars, temple === 'yixue' ? EST_YIXUE_PROMPT_TOKENS : EST_PROMPT_TOKENS)
                  const waiting = masters.filter(m => !answeredLast.has(m.id))
                  if (waiting.length === 0 && masters.length >= MAX_SEATS) return null
                  return (
                    <div className="xtell-join" role="group" aria-label={t('xtell.join.label')}>
                      {waiting.map(m => {
                        const usd = usdOf(m)
                        return <button key={m.id} type="button" className="xtell-join-btn" disabled={joining.includes(m.id)} onClick={() => void join(m)}>
                          {t('xtell.join.one').replace('{name}', m.display_name)}{usd != null && <small>{fmtUsdFor(usd, lang)}</small>}
                        </button>
                      })}
                      {masters.length < MAX_SEATS && <button type="button" className="xtell-join-btn is-add" onClick={() => setPicker({ replace: null, join: true })}>{t('xtell.join.add')}</button>}
                      <span>{t('xtell.join.note')}</span>
                    </div>
                  )
                })()}
              </div>
              )
            })}
            <div ref={endRef} />
          </div>

          {errShown && <div role="alert" style={{ color: 'var(--red)', fontSize: 12.5 }}>⚠ {errShown}</div>}

          {/* Composer — same shape as XDirect's. On the standalone site the
              block is sticky at the bottom, so the estimate line lives INSIDE
              it; placed after it, the line sat below the fold. */}
          {!savedProblem && !unverified && <div className={standalone ? "xtell-composer" : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Example questions, right where one is written, until the first
              is sent (owner, Sep 27: they were in a 「怎麼讀」 panel that
              mostly repeated the chart). A click fills the box; nothing is
              sent. 易學堂 has its own. */}
          {!daily && temple !== 'yixue' && turns.length === 0 && chart && <ExampleQuestions temple={temple} onExample={q => { setInput(q); composerRef.current?.focus() }} />}
          {masters.length > 1 && (
            <div role="group" aria-label={t('xtell.ask.to')} className="xtell-ask-to" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
              <span style={{ ...mono, color: 'var(--muted2)' }}>{t('xtell.ask.to')}</span>
              <button type="button" aria-pressed={askingAll} onClick={() => setAskTo(null)} disabled={busy} style={chip(askingAll)}>{t('xtell.ask.all')}</button>
              {masters.map(m => {
                const on = !askingAll && recipients.some(r => r.id === m.id)
                return <button key={m.id} type="button" aria-pressed={on} onClick={() => askingAll ? setAskTo([m.id]) : toggleAsk(m.id)} disabled={busy} style={chip(on)}>
                  <ProviderLogo provider={m.provider} size={12} /> {m.display_name}
                </button>
              })}
            </div>
          )}
          <div className="xtell-composer-row" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              ref={composerRef}
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
              aria-label={t(questionRequired ? 'xtell.yixue.question.label' : 'xtell.question.ph')}
              placeholder={daily ? t('xtell.dy.askPh') : questionRequired ? t('xtell.yixue.question.ph') : temple === 'yixue' ? t('xtell.question.ph') : `${t('xtell.q.example')}${t(`xtell.q.${temple}.1`)}`}
              maxLength={temple === 'yixue' ? 2000 : undefined}
              rows={4}
              style={{ flex: 1, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, resize: 'vertical' }}
            />
            <button aria-label={t('xtell.site.send')} onClick={() => void send(true)} disabled={busy || joining.length > 0 || (questionRequired && !input.trim())} style={{
              padding: '12px 20px', borderRadius: 10, border: 'none', background: 'var(--red)', color: 'var(--white)',
              fontWeight: 700, fontSize: 14, cursor: busy ? 'wait' : 'pointer',
              opacity: busy || (questionRequired && !input.trim()) ? 0.5 : 1,
            }}>{busy ? '…' : '→'}</button>
          </div>
          {/* What this question will roughly cost, per master, before Send. */}
          {(() => {
            const chars = turns.reduce((n, tn) => n + tn.content.length, 0) + input.length
            const known = recipients
              .map(m => ({ m, usd: estimateReadingUsd(m, { thinking: optsOf(m).thinking, search: optsOf(m).search && searchable(m) }, chars, temple === 'yixue' ? EST_YIXUE_PROMPT_TOKENS : EST_PROMPT_TOKENS) }))
              .filter((p): p is { m: PickerModel; usd: number } => p.usd != null)
            if (known.length === 0) return null
            const total = known.reduce((s, p) => s + p.usd, 0)
            return <div style={{ ...mono, fontSize: 11, color: 'var(--muted2)', lineHeight: 1.6 }}>
              {t('xtell.estimate').replace('{amount}', fmtUsdFor(total, lang))}
              {known.length > 1 && <> · {known.map(p => `${p.m.display_name} ${fmtUsdFor(p.usd, lang)}`).join(' · ')}</>}
            </div>
          })()}
          {questionRequired && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.yixue.question.privacy')}</p>}
          </div>}
        </div>
      )}

      {/* 「請一位老師」 (owner, Sep 28: the model browser was for developers). */}
      {picker && (
        <TeacherPicker
          catalog={catalog} seated={masters.map(m => m.id)} replacing={picker.replace} defaultModel={DEFAULT_MASTER}
          price={m => { const usd = estimateReadingUsd(m, { thinking: defaultThinking(m), search: false }, 0, temple === 'yixue' ? EST_YIXUE_PROMPT_TOKENS : EST_PROMPT_TOKENS); return usd == null ? null : fmtUsdFor(usd, lang) }}
          firstWord={m => firstWord(m, defaultThinking(m))}
          onSelect={m => {
            setMasters(ms => {
              if (ms.some(x => x.id === m.id)) return ms
              if (picker.replace) return ms.map(x => (x.id === picker.replace ? m : x))
              return ms.length >= MAX_SEATS ? ms : [...ms, m]
            })
            // Picked from 「追加老師」: seated, and answers the latest question now.
            if (picker.join) void join(m)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

// ── Where to start ──────────────────────────────────────────────────────────
// Audit (product): 紫微 and 九曜 opened straight into dense terms, so a result
// says one computed fact where it is safe to state (日主; 命宮 and its stars;
// 上升 and the Moon's 宿), at the top of the chart card, and offers three
// questions that fit the temple above the question box. (Until Sep 27 both
// sat in a 「怎麼讀」 panel with a line saying what the result was; the owner
// found it repeated the chart.) The examples fill the box; nothing is sent.
const GAN_ELEMENT: Record<string, string> = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' }
function chartFact(t: (k: string) => string, temple: Temple, chart: any, lang: string): string {
  try {
    if (temple === 'bazi' && GAN_ELEMENT[chart?.dayMaster]) return t('xtell.sum.bazi.fact').replace('{dm}', chart.dayMaster).replace('{el}', t(`xtell.el.${GAN_ELEMENT[chart.dayMaster]}`))
    if (temple === 'ziwei') {
      const p = chart?.palaces?.find((x: any) => x.name === '命宮')
      if (p) return t('xtell.sum.ziwei.fact').replace('{gz}', p.ganZhi).replace('{stars}', p.majorStars.map((x: string) => x.replace(/\[.*?\]/g, '')).join('、') || '—')
    }
    if (temple === 'sukuyo' && chart?.own) {
      const w = skWords(lang)
      return t('xtell.sum.sukuyo.fact').replace('{own}', w.shuku[chart.own.index]).replace('{day}', w.shuku[chart.day.index]).replace('{rel}', w.rel[chart.day.relation as keyof typeof w.rel])
    }
    if (temple === 'kyusei' && chart?.honmei) {
      const w = kyWords(lang)
      return t('xtell.sum.kyusei.fact').replace('{h}', w.star[chart.honmei]).replace('{g}', w.star[chart.getsumei])
    }
    if (temple === 'navagraha' && chart?.lagna) {
      const moon = chart.grahas?.find((g: any) => g.graha === 'Moon')
      return t('xtell.sum.navagraha.fact').replace('{lagna}', rasiName(t, lang, chart.lagna.rasi)).replace('{nak}', moon ? nakName(lang, moon.nakshatra) : '—')
    }
  } catch { /* an older saved chart shape simply has no fact line */ }
  return ''
}
function ExampleQuestions({ temple, onExample }: { temple: Temple; onExample: (q: string) => void }) {
  const t = useT()
  // Three per temple; 八字廟 has a fourth, the way into its 稱骨 card.
  const questions = [1, 2, 3, 4].map(i => t(`xtell.q.${temple}.${i}`)).filter(q => !q.startsWith('xtell.q.'))
  if (questions.length === 0) return null
  return (
    <div className="xtell-examples" role="group" aria-label={t('xtell.guide.ask')}>
      <span>{t('xtell.guide.ask')}</span>
      {questions.map(q => (
        <button key={q} type="button" onClick={() => onExample(q)} aria-label={`${t('xtell.guide.fill')}: ${q}`}>{q}</button>
      ))}
    </div>
  )
}

// ── 合盤 ────────────────────────────────────────────────────────────────────
// Every number here came out of lib/xtell.ts, and every row says which two
// 干支 it read and what relation it found — the same contract as the chart
// below it. Nothing on this card is the model's opinion.
function HeCard({ match }: { match: any }) {
  const t = useT()
  const { lang } = useLang()
  const band: Record<string, string> = {
    high: 'var(--score-elite)', good: 'var(--score-good)',
    mixed: 'var(--score-fair)', work: 'var(--score-poor)',
  }
  const colour = band[match.band] ?? 'var(--muted)'
  // Each row is coloured by ITS OWN score, not by the overall band. Painting a
  // 32 the same green as a 100 says the 六沖 is fine, which is the one thing
  // this card must not say.
  const rowColour = (n: number) => n >= 85 ? 'var(--score-elite)'
    : n >= 72 ? 'var(--score-good)'
    : n >= 58 ? 'var(--score-fair)'
    : 'var(--score-poor)'
  return (
    <div style={{ ...card, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ ...mono, color: 'var(--muted2)' }}>{t('xtell.he.title')}</div>
        <span style={{ flex: 1 }} />
        <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 30, fontWeight: 800, color: colour, lineHeight: 1 }}>
          {match.range ? `${match.range[0]}–${match.range[1]}` : match.overall}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t(`xtell.he.band.${match.band}`)}</div>
      </div>
      {/* What the number is, beside the number (audit: the weights explained
          only at the bottom read like a verdict on the couple). */}
      <p style={{ margin: '-4px 0 12px', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>{t('xtell.he.what')}</p>
      {match.range && <p role="note" style={{ margin: '0 0 12px', fontSize: 11.5, color: 'var(--red)', lineHeight: 1.6 }}>{t('xtell.he.rangeNote')}</p>}

      <div style={{ display: 'grid', gap: 8 }}>
        {match.dimensions.map((d: any) => (
          <div key={d.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, auto) 1fr minmax(72px, auto)', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{tOr(t, `xtell.he.dim.${d.key}`, d.label)}{d.undecided ? <span style={{ color: 'var(--red)', fontWeight: 500, fontSize: 11 }}> · {t('xtell.bazi.undecided')}</span> : null}</div>
            <div style={{ height: 6, borderRadius: 999, background: 'var(--surface2)', overflow: 'hidden' }}>
              <div style={{ width: `${d.score}%`, height: '100%', background: rowColour(d.score), opacity: 0.8 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'flex-end' }}>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12.5, fontWeight: 700, color: rowColour(d.score) }}>{d.range ? `${d.range[0]}–${d.range[1]}` : d.score}</span>
              <span style={{ ...mono, color: 'var(--muted2)', fontSize: 9.5 }}>×{d.weight}%</span>
            </div>
            <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--muted2)', marginTop: -4 }}>{relText(lang, d.detail)}</div>
          </div>
        ))}
      </div>

      {/* The years ahead. Only years whose 流年地支 actually 合 or 沖 a 日支 are
          listed; a year with nothing to say is left out rather than padded. */}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 8 }}>{t('xtell.he.years')}</div>
        {match.years.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted2)' }}>{t('xtell.he.noyears')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {match.years.map((y: any) => (
              <div key={y.year} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12.5 }}>
                <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 700, minWidth: 62 }}>{y.year}</span>
                <span style={{ ...mono, color: 'var(--muted2)', minWidth: 34 }}>{y.ganZhi}</span>
                <span style={{ color: y.good ? 'var(--green)' : 'var(--red)', fontWeight: 600, minWidth: 56 }}>{relText(lang, y.kind)}</span>
                <span style={{ color: 'var(--muted)' }}>{t(y.good ? 'xtell.he.year.good' : 'xtell.he.year.bad')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t('xtell.he.note')}</div>
    </div>
  )
}

/**
 * The four pillars. An unknown hour (audit F02) shows no clock time and no
 * 時柱, whatever the saved chart holds: a record saved before the fix still
 * carries a noon 時柱, and `hourUnknown` from its subject hides it. On a 節
 * day the pillars the date does not decide show both values, with the 節
 * and its moment; 大運 ages are marked approximate, or left out when the
 * month itself is undecided.
 */
function BaziBoard({ chart, hourUnknown = false }: { chart: any; hourUnknown?: boolean }) {
  const t = useT()
  const { lang } = useLang()
  const unknown = hourUnknown || chart.hourUnknown === true || !chart.pillars?.time
  const d = chart.doubt
  const cols = [
    { key: 'year', label: t('xtell.p.year') }, { key: 'month', label: t('xtell.p.month') },
    { key: 'day', label: t('xtell.p.day') }, { key: 'time', label: t('xtell.p.time') },
  ]
  const side = (i: 0 | 1) => [d?.year ? `${t('xtell.p.year')} ${d.year[i].ganZhi}` : '', d?.month ? `${t('xtell.p.month')} ${d.month[i].ganZhi}` : ''].filter(Boolean).join(t('xtell.list.sep'))
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        {unknown ? `${String(chart.solar).slice(0, 10)} · ${t('xtell.hourunknown')}` : chart.solar} · {lunarLocal(lang, chart.lunar)}
      </div>
      <div className="xtell-pillars" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, maxWidth: 560 }}>
        {cols.map(c => {
          if (c.key === 'time' && unknown) return (
            <div key="time" style={{ border: '1px dashed var(--border2)', borderRadius: 10, padding: '10px 8px', textAlign: 'center', color: 'var(--muted2)' }}>
              <div style={{ fontSize: 10.5, marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 20, fontWeight: 700 }}>{t('xtell.p.timeUnknown')}</div>
            </div>
          )
          const p = chart.pillars[c.key]
          const both = d?.[c.key] as Array<{ ganZhi: string; naYin: string }> | undefined
          return (
            <div key={c.key} style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 8px', textAlign: 'center', background: c.key === 'day' ? 'var(--surface2)' : 'transparent', minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: both ? 'var(--red)' : 'var(--muted2)', marginBottom: 6 }}>{c.label} · {both ? t('xtell.bazi.undecided') : p.shiShen}</div>
              <div style={{ fontFamily: 'var(--font-display), serif', fontSize: both ? 18 : 26, fontWeight: 800, letterSpacing: both ? 1 : 4 }}>{both ? `${both[0].ganZhi}／${both[1].ganZhi}` : p.ganZhi}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 6 }}>{both ? `${naYinLocal(lang, both[0].naYin)}／${naYinLocal(lang, both[1].naYin)}` : naYinLocal(lang, p.naYin)}</div>
              {!both && <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{t('xtell.p.hidden')} {p.hideGan.join(' ')}</div>}
            </div>
          )
        })}
      </div>
      {unknown && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>{t('xtell.bazi.hourNote')}</div>}
      {d && (
        <div role="note" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.7, padding: '8px 10px', border: '1px solid var(--border2)', borderRadius: 8, background: 'var(--surface2)' }}>
          {t('xtell.bazi.doubt').replace('{term}', d.term.name).replace('{time}', d.term.time).replace('{before}', side(0)).replace('{after}', side(1)).split('{box}').join(t('xtell.hourunknown'))}
        </div>
      )}
      {chart.daYun?.length > 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
          {t('xtell.dayun')}：{chart.daYun.map((x: any) => t(unknown ? 'xtell.dayun.stepApprox' : 'xtell.dayun.step').replace('{n}', String(x.startAge)).replace('{gz}', x.ganZhi)).join('　')}
          {unknown && <div style={{ fontSize: 11, color: 'var(--muted2)' }}>{t('xtell.dayun.approx')}</div>}
        </div>
      ) : d ? <div style={{ fontSize: 11.5, color: 'var(--muted2)', marginTop: 10 }}>{t('xtell.dayun.hidden')}</div> : null}
      {t('xtell.bazi.glossary') && <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.bazi.glossary')}</p>}
    </div>
  )
}

/** Weight position and editorial themes; unknown hours retain discrete alternatives. */
function ChengguCard({ data, onAsk, disabled }: { data: Chenggu; onAsk: (question: string) => void; disabled?: boolean }) {
  const t = useT()
  const { lang } = useLang()
  const titleId = useId()
  if (!data?.lunar || !data?.weights) return null   // an unexpected saved shape
  const w = (q: number) => weightText(q, lang)
  const fill = (s: string, vars: Record<string, string>) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), s)
  const zh = lang === 'zh-Hant' || lang === 'zh-Hans'
  const monthOf = (l: ChengguLunar) => zh ? `${l.leap ? (lang === 'zh-Hans' ? '闰' : '閏') : ''}${monthZh(l.month, lang)}`
    : lang === 'ja' ? `${l.leap ? '閏' : ''}${l.month}月` : lang === 'ko' ? `${l.leap ? '윤' : ''}${l.month}월` : `${l.leap ? 'leap ' : ''}${l.month}`
  const dayOf = (d: number) => zh ? dayZh(d) : lang === 'ja' ? `${d}日` : lang === 'ko' ? `${d}일` : String(d)
  const hourOf = (z: keyof typeof ZHI_SPAN) => fill(t('xtell.cg.val.hour'), { zhi: z, span: ZHI_SPAN[z] })
  const dateOf = (l: ChengguLunar) => fill(t('xtell.cg.date'), { gz: l.yearGanZhi, m: monthOf(l), d: dayOf(l.day) })
  const L = data.lunar
  const known = data.total !== null && data.zhi !== null
  const totals = known ? [data.total as number] : (data.options ?? []).map(o => o.total)
  const markers = totals.filter(q => chengguTheme(q) !== null)
  const theme = known ? chengguTheme(data.total as number, lang) : null
  const values = totals.map(w).join(t('xtell.list.sep'))
  const rows = [
    { key: 'year', label: t('xtell.cg.row.year'), value: L.yearGanZhi, qian: data.weights.year },
    { key: 'month', label: t('xtell.cg.row.month'), value: `${monthOf(L)}${L.leap ? fill(t('xtell.cg.leapAs'), { cn: monthZh(L.month, lang), n: String(L.month) }) : ''}`, qian: data.weights.month },
    { key: 'day', label: t('xtell.cg.row.day'), value: dayOf(L.day), qian: data.weights.day },
    { key: 'hour', label: t('xtell.cg.row.hour'), value: data.zhi ? hourOf(data.zhi) : t('xtell.hourunknown'), qian: data.weights.hour },
  ]
  const note = { fontSize: 12, marginTop: 8, lineHeight: 1.7, padding: '8px 10px', border: '1px solid var(--border2)', borderRadius: 8, background: 'var(--surface2)' }
  return (
    <section aria-labelledby={titleId} className="xtell-chenggu" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <h3 id={titleId} style={{ ...mono, color: 'var(--muted2)', margin: 0, fontWeight: 600 }}>{t('xtell.cg.title')}</h3>
      {known ? (
        <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-display), serif', fontSize: 26, fontWeight: 800, letterSpacing: 1 }}>{w(data.total as number)}</p>
      ) : (
        <div style={{ marginTop: 6 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t('xtell.cg.unknown.total')}</p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>{t('xtell.cg.unknown.lead')}</p>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8 }}>
            {(data.options ?? []).map(o => (
              <li key={o.total}>
                <b>{w(o.total)}</b>{t('xtell.cg.option.sep')}{o.zhi.map(hourOf).join(t('xtell.list.sep'))}
                {chengguTheme(o.total, lang) && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{fill(t('xtell.cg.theme'), { theme: chengguTheme(o.total, lang)! })}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {markers.length > 0 && <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--muted2)', marginBottom: 8 }}>{t('xtell.cg.position')}</div>
        <div role="img" aria-label={fill(t('xtell.cg.scaleLabel'), { min: w(CHENGGU_MIN), max: w(CHENGGU_MAX), values })} style={{ padding: '0 6px' }}>
          <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--border2)' }}>
            {markers.map(q => <span key={q} aria-hidden="true" style={{ position: 'absolute', left: `${(q - CHENGGU_MIN) / (CHENGGU_MAX - CHENGGU_MIN) * 100}%`, top: -3, width: 12, height: 12, transform: 'translateX(-50%)', borderRadius: '50%', background: 'var(--red)', border: '2px solid var(--surface)', boxSizing: 'border-box' }} />)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
          <div style={{ flex: 1 }}>{fill(t('xtell.cg.light'), { w: w(CHENGGU_MIN) })}<div>{t('xtell.cg.lightMeaning')}</div></div>
          <div style={{ flex: 1, textAlign: 'right' }}>{fill(t('xtell.cg.heavy'), { w: w(CHENGGU_MAX) })}<div>{t('xtell.cg.heavyMeaning')}</div></div>
        </div>
      </div>}
      {theme && <div style={{ marginTop: 12, lineHeight: 1.7, fontSize: 13 }}>
        <strong>{t('xtell.cg.meaning')}</strong>
        <p style={{ margin: '4px 0 0' }}>{fill(t('xtell.cg.theme'), { theme })}</p>
      </div>}
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0', lineHeight: 1.6 }}>{t('xtell.cg.reflection')}</p>
      <button type="button" aria-label={`${t('xtell.guide.fill')}: ${t('xtell.cg.ask')}`} disabled={disabled || totals.length === 0} onClick={() => onAsk(known
        ? fill(t('xtell.cg.askPrompt'), { w: w(data.total as number) })
        : fill(t('xtell.cg.askUnknown'), { values }))} style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid var(--border2)', background: 'var(--surface2)', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
        {t('xtell.cg.ask')}
      </button>
      <details open style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 12, color: 'var(--muted2)', cursor: 'pointer' }}>{t('xtell.cg.parts')}</summary>
        <table style={{ marginTop: 6, borderCollapse: 'collapse', fontSize: 12.5, width: '100%', maxWidth: 440 }}>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} style={{ borderBottom: '1px solid var(--border)' }}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 500, color: 'var(--muted2)', padding: '5px 10px 5px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{r.label}</th>
                <td style={{ padding: '5px 10px 5px 0' }}>{r.value}</td>
                <td style={{ padding: '5px 0', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{r.qian === null ? '—' : w(r.qian)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" colSpan={2} style={{ textAlign: 'left', padding: '6px 10px 0 0' }}>{t(known ? 'xtell.cg.total' : 'xtell.cg.fixed')}</th>
              <td style={{ padding: '6px 0 0', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>{w(known ? data.total as number : data.fixed)}</td>
            </tr>
          </tbody>
        </table>
      </details>
      {data.lateZi && <div role="note" style={note}>{fill(t('xtell.cg.lateZi'), { date: dateOf(data.lateZi.lunar), w: w(data.lateZi.total) })}</div>}
      {(data.variants ?? []).map(v => (
        <div key={v.entry} role="note" style={note}>
          {fill(t(`xtell.cg.variant.${v.entry}`), { other: w(v.other), v1: w(v.v1), alt: v.total === null ? '' : fill(t('xtell.cg.variant.alt'), { other: w(v.other), w: w(v.total) }) })}
        </div>
      ))}
    </section>
  )
}

/** This year's 流年 against a chart (四面佛, and a 求籤 with a birth). An
 *  undecided 年柱 gives the 太歲 relation both ways; with the hour unknown
 *  the 大運 in force is approximate, or either of two near a change. */
function LiuNianLine({ year }: { year: any }) {
  const t = useT()
  const { lang } = useLang()
  // 值太歲 is the birth year's own branch come round again: the engine calls
  // the branches' relation 「無特殊關係」 there, which beside the 太歲 note
  // read as a contradiction, so the note stands alone.
  const rel = (kind: string, taiSui: string) => {
    const ts = taiSui && taiSui !== '無' ? (TAI_SUI[lang]?.[taiSui] ?? taiSui) : ''
    return taiSui === '值太歲' && kind === '無特殊關係' ? ts : `${relText(lang, kind)}${ts ? `（${ts}）` : ''}`
  }
  const vsYear = Array.isArray(year.yearChoices)
    ? t('xtell.liunian.yearUndecided').replace('{list}', year.yearChoices.map((c: any) => t('xtell.liunian.ifYear').replace('{gz}', c.ganZhi).replace('{rel}', rel(c.yearBranch?.kind, c.taiSui))).join(t('xtell.list.sep')))
    : rel(year.yearBranch?.kind, year.taiSui)
  return (
    <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>
      <span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.liunian')}</span>
      {year.year} {year.ganZhi}　{t('xtell.liunian.vsDay')} <b>{year.shiShen}</b>　{t('xtell.liunian.vsDayBranch')} <b>{relText(lang, year.dayBranch?.kind)}</b>　{t('xtell.liunian.vsYear')} <b>{vsYear}</b>
      {Array.isArray(year.daYunChoices)
        ? <>　{t('xtell.dayun')} <b>{year.daYunChoices.join('／')}</b> <span style={{ fontSize: 11 }}>（{t('xtell.dayun.approx')}）</span></>
        : year.daYun ? <>　{t('xtell.dayun')} <b>{year.daYun}</b>{year.daYunApprox ? <span style={{ fontSize: 11 }}>（{t('xtell.dayun.approx')}）</span> : null}</> : null}
    </div>
  )
}

function ZiweiBoard({ chart }: { chart: any }) {
  const t = useT()
  const { lang } = useLang()
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        {chart.solar} · {lunarLocal(lang, chart.lunar)} {chart.time} · {chart.fiveElementsClass} · {t('xtell.ziwei.soul')} {chart.soul} · {t('xtell.ziwei.body')} {chart.body}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {chart.palaces.map((p: any) => (
          <div key={p.name} style={{
            border: '1px solid ' + (p.name === '命宮' ? 'var(--red)' : 'var(--border2)'),
            borderRadius: 10, padding: '8px 10px', background: p.name === '命宮' ? 'var(--surface2)' : 'transparent',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <b style={{ fontSize: 12.5 }}>{p.name}{p.isBodyPalace ? '・身' : ''}</b>
              <span style={{ fontSize: 10.5, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>{p.ganZhi}</span>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>{p.majorStars.join('、') || <span style={{ color: 'var(--muted2)' }}>—</span>}</div>
            {p.minorStars.length > 0 && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{p.minorStars.join('、')}</div>}
          </div>
        ))}
      </div>
      {chart.horoscope && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 12.5, lineHeight: 1.8, color: 'var(--muted)' }}>
          <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 4 }}>{t('xtell.ziwei.periods')}</div>
          {[chart.horoscope.decadal, ...chart.horoscope.years, chart.horoscope.month].map((p: any, k: number) => (
            <div key={k}>
              <b style={{ color: 'var(--white)' }}>{p.name}{p.year ? ` ${p.year}` : ''}{p.label ? ` ${p.label}` : ''}</b>
              <span style={{ fontFamily: 'var(--font-mono), monospace', margin: '0 8px' }}>{p.ganZhi}{p.range ? ` · ${p.range[0]}–${p.range[1]}${lang === 'ja' ? '歳' : lang === 'zh-Hans' ? '岁' : lang === 'ko' ? '세' : lang === 'en' ? '' : '歲'}` : ''}</span>
              {t('xtell.ziwei.lands')} <b style={{ color: 'var(--white)' }}>{p.palace}</b>　
              <span style={{ color: 'var(--muted2)' }}>祿{p.mutagen[0]} 權{p.mutagen[1]} 科{p.mutagen[2]} 忌{p.mutagen[3]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


type FieldAria = { invalid: boolean; describedBy?: string }
/** Rooms with a birth row for the visitor (the stick rooms' is optional). */
const TAKES_BIRTH = (temple: string) => !['tarot', 'cezi', 'jiemeng', 'sunzi', 'cookie', 'yixue', 'xingming'].includes(temple)

/** The visitor's saved birthday: the daily fortune's profile (server), else
 *  this browser's copy from 占星. Loaded quietly, never shown until the
 *  visitor presses 「填入我的生日」. */
function useMyBirth(enabled: boolean): ReturnType<typeof rememberedBirth> {
  const [v, setV] = useState<ReturnType<typeof rememberedBirth>>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const local = (() => { try { return rememberedBirth(localStorage.getItem(REMEMBER_KEY)) } catch { return null } })()
    fetch('/api/xtell/profile').then(r => r.ok ? r.json() : null).then(d => {
      if (!live) return
      const server = d?.profile?.birth ? rememberedBirth(JSON.stringify(d.profile.birth)) : null
      if (!server) { setV(local); return }
      const same = !!local && local.y === server.y && local.m === server.m && local.d === server.d
      setV({ ...server, ...(same && local!.gender ? { gender: local!.gender } : {}), ...(same && local!.place ? { place: local!.place } : {}) })
    }).catch(() => { if (live) setV(local) })
    return () => { live = false }
  }, [enabled])
  return v
}

function BirthRow({ label, value, onChange, sel, allowUnknown = true, aria, onFill }: {
  label?: string
  /** 「填入我的生日」: shown only when the visitor has a saved birthday; never
   *  filled without the press (owner, Oct 1). */
  onFill?: () => void
  value: { y: number; m: number; d: number; h: number; mi: number; gender: 'male' | 'female'; hourUnknown?: boolean }
  onChange: (v: any) => void
  sel: any
  /** 紫微 cannot place 命宮 without an hour, so the checkbox hides there. */
  allowUnknown?: boolean
  /** Set when the room's current refusal is about this birth. */
  aria?: FieldAria
}) {
  const t = useT()
  // Only real days are offered (audit F01). When a month or year change
  // leaves the chosen day impossible (31 → February), the day is KEPT and
  // flagged rather than silently moved to another date; entering is refused
  // until the visitor picks again.
  const maxDay = daysInMonth(value.y, value.m)
  const dayBad = value.d > maxDay
  const dayMsg = useId()
  const years = birthYears()
  // The date selects carry the room's refusal too (a future date, 1899…).
  const bad = !!aria?.invalid
  const described = [dayBad ? dayMsg : '', bad ? aria?.describedBy ?? '' : ''].filter(Boolean).join(' ') || undefined
  const dateSel = (on: boolean) => ({ ...sel, ...(on ? { borderColor: 'var(--red)' } : {}) })
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {label && <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 52 }}>{label}</span>}
      {onFill && (
        <button type="button" onClick={onFill} className="xtell-fill-mine">{t('xtell.fillMine')}</button>
      )}
      <label className="xtell-birth-field"><select aria-label={`${label ?? ""} ${t("xtell.site.birth.year")}`} aria-invalid={bad || undefined} aria-describedby={bad ? described : undefined} style={dateSel(bad)} value={value.y} onChange={e => onChange({ ...value, y: +e.target.value })}>
        {!years.includes(value.y) && <option value={value.y} disabled>{value.y}</option>}
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.year')}</span></label>
      <label className="xtell-birth-field"><select aria-label={`${label ?? ""} ${t("xtell.site.birth.month")}`} aria-invalid={bad || undefined} aria-describedby={bad ? described : undefined} style={dateSel(bad)} value={value.m} onChange={e => onChange({ ...value, m: +e.target.value })}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.month')}</span></label>
      <label className="xtell-birth-field"><select aria-label={`${label ?? ""} ${t("xtell.site.birth.day")}`} aria-invalid={dayBad || bad || undefined} aria-describedby={described}
        style={dateSel(dayBad || bad)} value={value.d} onChange={e => onChange({ ...value, d: +e.target.value })}>
        {Array.from({ length: maxDay }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
        {dayBad && <option value={value.d} disabled>{value.d} ✕</option>}
      </select>
      <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.day')}</span></label>
      <span className="xtell-birth-time"><select aria-label={`${label ?? ""} ${t("xtell.site.birth.hour")}`} style={{ ...sel, opacity: value.hourUnknown ? 0.4 : 1 }} disabled={!!value.hourUnknown} value={value.h} onChange={e => onChange({ ...value, h: +e.target.value })}>
        {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
      </select>
      :
      <select aria-label={`${label ?? ""} ${t("xtell.site.birth.minute")}`} style={{ ...sel, opacity: value.hourUnknown ? 0.4 : 1 }} disabled={!!value.hourUnknown} value={value.mi} onChange={e => onChange({ ...value, mi: +e.target.value })}>
        {MINUTES.map(mi => <option key={mi} value={mi}>{String(mi).padStart(2, '0')}</option>)}
      </select>
      <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted2)' }}>{value.hourUnknown ? '—' : shichenOf(value.h)}</span></span>
      {allowUnknown && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: 'var(--muted)' }}>
          <input type="checkbox" checked={!!value.hourUnknown} onChange={e => onChange({ ...value, hourUnknown: e.target.checked })} />
          {t('xtell.hourunknown')}
        </label>
      )}
      {(['male', 'female'] as const).map(g => (
        <label key={g} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
          <input type="radio" checked={value.gender === g} onChange={() => onChange({ ...value, gender: g })} />
          {t(`xtell.${g}`)}
        </label>
      ))}
      {dayBad && (
        <span id={dayMsg} role="alert" style={{ flexBasis: '100%', color: 'var(--red)', fontSize: 12, lineHeight: 1.6 }}>
          {t('xtell.birth.dayInvalid').replace('{y}', String(value.y)).replace('{m}', String(value.m)).replace('{d}', String(value.d))}
        </span>
      )}
    </div>
  )
}


// ── 關帝廟 ─────────────────────────────────────────────────────────────────

/** 稟明事由, then the tube and the blocks. */
function RitualPanel({ ask, setAsk, stick, ritual, onDraw, onThrow, bing, setBing, birth, setBirth, sel, jiao = true, onFillBirth }: {
  ask: string; setAsk: (s: string) => void
  stick: { n: number; throws: Jiao[] } | null
  ritual: 'idle' | 'drawn' | 'rejected' | 'confirmed'
  onDraw: () => void; onThrow: () => void
  bing: { name: string; city: string; withBirth: boolean }; setBing: (b: { name: string; city: string; withBirth: boolean }) => void
  birth: any; setBirth: (b: any) => void; sel: any
  /** false for 元三大師's set: draw once, no 筊. */
  jiao?: boolean
  /** 「填入我的生日」, when the visitor has one saved. */
  onFillBirth?: () => void
}) {
  const t = useT()
  const [bingOpen, setBingOpen] = useState(false)
  const locked = ritual === 'confirmed'
  // A 稟告 birth that cannot be charted would fail only after the third
  // 聖筊; it is caught before the tube is shaken instead.
  const birthBad = bing.withBirth ? birthProblem(birth) : null
  const pill = (bg: string) => ({ padding: '10px 26px', borderRadius: 999, border: 'none', background: bg, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' })
  const jiaoColour: Record<Jiao, string> = { 聖筊: 'var(--green)', 笑筊: 'var(--muted)', 陰筊: 'var(--red)' }
  const jiaoKey: Record<Jiao, string> = { 聖筊: 'sheng', 笑筊: 'xiao', 陰筊: 'yin' }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.qian.ask')}</div>
        <input value={ask} onChange={e => setAsk(e.target.value.slice(0, 300))} placeholder={t('xtell.qian.ask.ph')} aria-label={t('xtell.qian.ask')}
          disabled={ritual === 'confirmed'}
          style={{ width: '100%', background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 14px', color: 'var(--white)', fontSize: 14 }} />
      </div>

      {/* 稟告 — optional, collapsed. The stick never needs it; the master
          uses whatever is filled in to address the visitor and, with a
          birth, to read the stick against this year. */}
      <div style={{ border: '1px dashed var(--border2)', borderRadius: 10, padding: bingOpen ? '10px 14px 12px' : '8px 14px' }}>
        <button type="button" onClick={() => setBingOpen(v => !v)} disabled={locked}
          style={{ border: 'none', background: 'none', padding: 0, cursor: locked ? 'default' : 'pointer', color: 'var(--muted)', fontSize: 12.5, fontWeight: 600 }}>
          {bingOpen ? '▾' : '▸'} {t('xtell.qian.bing')}
        </button>
        {bingOpen && (
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.qian.bing.note')}</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input value={bing.name} maxLength={20} disabled={locked} onChange={e => setBing({ ...bing, name: e.target.value })} placeholder={t('xtell.qian.bing.name')} aria-label={t('xtell.qian.bing.name')} style={{ ...sel, flex: 1, minWidth: 160 }} />
              <input value={bing.city} maxLength={20} disabled={locked} onChange={e => setBing({ ...bing, city: e.target.value })} placeholder={t('xtell.qian.bing.city')} aria-label={t('xtell.qian.bing.city')} style={{ ...sel, flex: 1, minWidth: 160 }} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={bing.withBirth} disabled={locked} onChange={e => setBing({ ...bing, withBirth: e.target.checked })} />
              {t('xtell.qian.bing.birth')}
            </label>
            {bing.withBirth && <BirthRow value={birth} onChange={setBirth} sel={sel} onFill={onFillBirth} />}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', minHeight: 56 }}>
        {stick ? (
          <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 30, fontWeight: 800, letterSpacing: 2 }}>
            {t('xtell.qian.stick')} {stick.n} {t('xtell.qian.stickunit')}
          </div>
        ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t(jiao ? 'xtell.qian.rule' : 'xtell.qian.rule.omikuji')}<div style={{ fontSize: 11.5, color: 'var(--muted2)', marginTop: 4, lineHeight: 1.6 }}>{t(jiao ? 'xtell.qian.random' : 'xtell.qian.random.omikuji')}</div></div>}
        {stick && jiao && (
          <div style={{ display: 'flex', gap: 6 }}>
            {Array.from({ length: CONFIRM_THROWS }, (_, i) => {
              const j = stick.throws[i]
              return (
                <span key={i} title={j ? t('xtell.qian.jiao.' + jiaoKey[j]) : undefined} style={{
                  minWidth: 44, textAlign: 'center', padding: '5px 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                  border: '1px solid ' + (j ? jiaoColour[j] : 'var(--border2)'), color: j ? jiaoColour[j] : 'var(--muted2)',
                  background: j === '聖筊' ? 'var(--green-dim)' : 'transparent',
                }}>{j ?? '·'}</span>
              )
            })}
          </div>
        )}
        <span style={{ flex: 1 }} />
        {ritual === 'idle' && <button onClick={onDraw} disabled={!!birthBad} style={{ ...pill('var(--red)'), opacity: birthBad ? 0.5 : 1, cursor: birthBad ? 'not-allowed' : 'pointer' }}>{t('xtell.qian.draw')}</button>}
        {ritual === 'drawn' && <button onClick={onThrow} style={pill('var(--white)')}>{t('xtell.qian.throw')} {stick?.throws.length ?? 0}/{CONFIRM_THROWS}</button>}
        {ritual === 'rejected' && <button onClick={onDraw} style={pill('var(--red)')}>{t('xtell.qian.redraw')}</button>}
        {ritual === 'confirmed' && jiao && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>{t('xtell.qian.confirmed')}</span>}
      </div>
      {ritual === 'idle' && birthBad && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>{errorText(t, `birth_${birthBad}`, birthBad)}</div>}
      {ritual === 'rejected' && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{t('xtell.qian.rejected')}</div>}
      {stick && jiao && ritual !== 'rejected' && <div style={{ fontSize: 11.5, color: 'var(--muted2)' }}>{t('xtell.qian.rule')}</div>}
    </div>
  )
}

/** The stick, as the temple prints it: number, luck, story, the four lines,
 *  and every commentary the edition carries. All of it is text from disk. */
function QianCard({ qian, temple, bazi, year, hourUnknown = false }: { qian: any; temple: Temple; bazi?: any; year?: any; hourUnknown?: boolean }) {
  const t = useT()
  const { lang } = useLang()
  // 關帝's edition grades each stick (大吉 … 下下); 媽祖's carries a 五行/direction
  // line instead, which is a hint, not a grade, so it stays neutral.
  const graded = temple !== 'mazu'
  // 凶/下 poor, 上/大 good, everything between (中, 吉, 半吉, 末吉 …) fair.
  const luckColour = !graded ? 'var(--muted)' : /凶|下/.test(qian.luck) ? 'var(--score-poor)' : /上|大/.test(qian.luck) ? 'var(--score-elite)' : 'var(--score-fair)'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 20, fontWeight: 800 }}>{t('xtell.history.stick').replace('{n}', String(qian.n))}　{qian.ganZhi}</div>
        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: graded ? 18 : 14, fontWeight: graded ? 800 : 600, color: luckColour }}>{mazuLuck(t, lang, qian.luck)}</div>
        {qian.story && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{qian.story}</div>}
        <span style={{ flex: 1 }} />
        <ShareButton spec={() => ({ icon: temple, link: temple, title: t(`xtell.site.focus.${temple}.name`),
          kicker: [t('xtell.history.stick').replace('{n}', String(qian.n)), qian.ganZhi, qian.luck].filter(Boolean).join('　'),
          body: qian.poem, style: 'poem', name: `xtell-${temple}-${qian.n}` })} />
      </div>
      <div style={{ padding: '18px 16px', background: 'var(--surface2)', borderRadius: 10, textAlign: 'center' }}>
        {qian.poem.map((l: string, i: number) => (
          <div key={i} style={{ fontFamily: 'var(--font-display), serif', fontSize: 22, fontWeight: 700, letterSpacing: 3, lineHeight: 1.8 }}>{l}</div>
        ))}
      </div>
      {/* Japanese pages: the 書き下し文 and a modern translation, as a Japanese
          おみくじ prints them. Written once by an AI and labelled so. */}
      {lang === 'ja' && qian.ja && Array.isArray(qian.ja.kundoku) && (
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <div>
            <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 4 }}>{t('xtell.qian.kundoku')}</div>
            {qian.ja.kundoku.map((l: string, i: number) => <div key={i} style={{ fontSize: 14.5, lineHeight: 1.85 }}>{l}</div>)}
          </div>
          <div>
            <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 4 }}>{t('xtell.qian.modern')}</div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.8, color: 'var(--muted)' }}>{qian.ja.modern}</p>
          </div>
        </div>
      )}
      {Object.keys(qian.sections ?? {}).length > 0 && <div style={{ ...mono, color: 'var(--muted2)', margin: '14px 0 8px' }}>{t(temple === 'mazu' ? 'xtell.qian.notes.mazu' : 'xtell.qian.notes')}</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {Object.entries(qian.sections as Record<string, string>).map(([name, text]) => (
          // 媽祖's one section is its heading (「卦頭故事」 was printed twice).
          <div key={name} style={{ display: 'grid', gridTemplateColumns: temple === 'mazu' ? '1fr' : '64px 1fr', gap: 10, fontSize: 13, lineHeight: 1.7 }}>
            {temple !== 'mazu' && <b style={{ color: 'var(--muted)' }}>{name}</b>}
            <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
          </div>
        ))}
      </div>
      {bazi && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 8 }}>{t('xtell.qian.bing.head')}</div>
          <BaziBoard chart={bazi} hourUnknown={hourUnknown} />
          {year && <div style={{ marginTop: 8 }}><LiuNianLine year={year} /></div>}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t(temple === 'mazu' ? 'xtell.qian.source.mazu' : temple === 'guanyin' ? `xtell.qian.source.guanyin.${asQianEdition(qian.edition)}` : 'xtell.qian.source')}</div>
    </div>
  )
}

// ── 四面佛 ─────────────────────────────────────────────────────────────────

function WishForm({ wishes, setWishes, aria }: { wishes: Wishes; setWishes: (w: Wishes) => void; aria?: FieldAria }) {
  const t = useT()
  const id = useId()
  const bad = !!aria?.invalid
  const area = { width: '100%', background: '#ffffff', border: `1px solid ${bad ? 'var(--red)' : 'var(--border2)'}`, borderRadius: 10, padding: '9px 12px', color: 'var(--white)', fontSize: 13.5, resize: 'vertical' as const }
  // The rule (at least one face) is said before sending, not after (F05);
  // each field is named by its face, not by a shared placeholder (F07).
  return (
    <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
      <div id={`${id}-note`} style={{ fontSize: 12, color: bad ? 'var(--red)' : 'var(--muted)', lineHeight: 1.6 }}>{t('xtell.face.note')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {FACE_KEYS.map(k => (
          <div key={k}>
            <div id={`${id}-${k}`} style={{ ...mono, color: 'var(--muted2)', marginBottom: 5 }}>{t(`xtell.face.${k}`)}</div>
            <textarea rows={2} value={wishes[k] ?? ''} onChange={e => setWishes({ ...wishes, [k]: e.target.value.slice(0, 400) })}
              aria-labelledby={`${id}-${k}`} aria-describedby={[`${id}-note`, bad ? aria?.describedBy : ''].filter(Boolean).join(' ')} aria-invalid={bad || undefined}
              placeholder={t('xtell.wish.ph')} style={area} />
          </div>
        ))}
      </div>
      <div>
        <div id={`${id}-pledge`} style={{ ...mono, color: 'var(--muted2)', marginBottom: 5 }}>{t('xtell.pledge')}</div>
        <textarea rows={2} value={wishes.pledge ?? ''} onChange={e => setWishes({ ...wishes, pledge: e.target.value.slice(0, 400) })}
          aria-labelledby={`${id}-pledge`} placeholder={t('xtell.pledge.ph')} style={{ ...area, border: '1px solid var(--border2)' }} />
      </div>
    </div>
  )
}

/** The 八字 board, this year's 流年 against it, and the four wishes as
 *  written — the same facts the keeper was handed. */
function WishBoard({ chart, wishes, year, hourUnknown = false }: { chart: any; wishes: Wishes; year: any; hourUnknown?: boolean }) {
  const t = useT()
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <BaziBoard chart={chart} hourUnknown={hourUnknown} />
      {year && <LiuNianLine year={year} />}
      <div>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.wishes.title')}</div>
        <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          {FACE_KEYS.map(k => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
              <span style={{ color: 'var(--muted)' }}>{t(`xtell.face.${k}`)}</span>
              <span style={{ whiteSpace: 'pre-wrap' }}>{(wishes[k] ?? '').trim() || <span style={{ color: 'var(--muted2)' }}>—</span>}</span>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
            <span style={{ color: 'var(--muted)' }}>{t('xtell.pledge')}</span>
            <span style={{ whiteSpace: 'pre-wrap' }}>{(wishes.pledge ?? '').trim() || <span style={{ color: 'var(--muted2)' }}>—</span>}</span>
          </div>
        </div>
      </div>
    </div>
  )
}


// ── 九曜廟 ─────────────────────────────────────────────────────────────────

/** Lagna, the nine grahas (sign, degree, house, nakshatra-pada, D9), and
 *  the Vimshottari timeline. Every value came out of lib/jyotish.ts. */
/** 宿曜占星術 (Sep 29): the 本命宿, today's 宿 and what it is to it, a
 *  partner's relation if one was given, and the 三九 table of all twenty-
 *  seven as seen from one's own; the numbers come from lib/sukuyo.ts. */
const SHUKU_ONE: Record<string, string[]> = {
  ko: ['묘', '필', '자', '삼', '정', '귀', '류', '성', '장', '익', '진', '각', '항', '저', '방', '심', '미', '기', '두', '여', '허', '위', '실', '벽', '규', '루', '위'],
  'zh-Hans': ['昴', '毕', '觜', '参', '井', '鬼', '柳', '星', '张', '翼', '轸', '角', '亢', '氐', '房', '心', '尾', '箕', '斗', '女', '虚', '危', '室', '壁', '奎', '娄', '胃'],
  'zh-Hant': ['昴', '畢', '觜', '參', '井', '鬼', '柳', '星', '張', '翼', '軫', '角', '亢', '氐', '房', '心', '尾', '箕', '斗', '女', '虛', '危', '室', '壁', '奎', '婁', '胃'],
  ja: ['昴', '畢', '觜', '参', '井', '鬼', '柳', '星', '張', '翼', '軫', '角', '亢', '氐', '房', '心', '尾', '箕', '斗', '女', '虚', '危', '室', '壁', '奎', '婁', '胃'],
}
function SukuyoBoard({ chart }: { chart: any }) {
  const { lang, t } = useLang()
  if (!chart?.own || !chart?.ring) return null
  const w = skWords(lang)
  const one = SHUKU_ONE[lang] ?? SHUKU_ONE.ja
  const rel = (r: string) => w.rel[r as keyof typeof w.rel] ?? r
  const tone = (r: string) => GOOD_DAY.has(r) ? 'is-good' : HARD_DAY.has(r) ? 'is-hard' : 'is-plain'
  const lunar = (x: any) => t('xtell.sk.lunar').replace('{leap}', x.leap ? t('xtell.sk.leapMark') : '').replace('{m}', String(x.month)).replace('{d}', String(x.day))
  // The 三九 table: from one's own 宿, three rows of nine (一九, 二九, 三九).
  const rows = [0, 1, 2].map(r => Array.from({ length: 9 }, (_, i) => (chart.own.index + r * 9 + i) % 27))
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="xtell-sk-head">
        <div><small>{t('xtell.sk.own')}</small><strong>{w.shuku[chart.own.index]}</strong><span>{lunar(chart.own.lunar)}</span></div>
        <div><small>{t('xtell.sk.today').replace('{date}', chart.today)}</small><strong>{w.shuku[chart.day.index]}</strong>
          <span className={`xtell-sk-rel ${tone(chart.day.relation)}`}>{t('xtell.sk.dayOf').replace('{rel}', rel(chart.day.relation))}</span></div>
      </div>
      <p className="xtell-sk-meaning">{t(`xtell.sk.day.${chart.day.relation}`)}</p>
      {chart.own.lunar.leap && <p className="xtell-ky-note">{t('xtell.sk.leap')}</p>}
      {chart.partner && (
        <div className="xtell-sk-partner">
          <div><small>{t('xtell.sk.partnerOwn')}</small><strong>{w.shuku[chart.partner.index]}</strong><span>{chart.partner.date}</span></div>
          <div><small>{t('xtell.sk.pair')}</small><strong>{w.pair[chart.partner.pair] ?? chart.partner.pair}</strong>
            <span>{t('xtell.sk.fromMe').replace('{rel}', rel(chart.partner.fromMe))} · {t('xtell.sk.fromThem').replace('{rel}', rel(chart.partner.fromThem))}</span></div>
        </div>
      )}
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{t('xtell.sk.ring')}</div>
        <div className="xtell-sk-table" role="table" aria-label={t('xtell.sk.ring')}>
          {rows.map((row, r) => (
            <div key={r} role="row" className="xtell-sk-row">
              {row.map(i => (
                <div key={i} role="cell" className={['xtell-sk-cell', tone(chart.ring[i]), i === chart.own.index ? 'is-own' : '', i === chart.day.index ? 'is-today' : '', chart.partner?.index === i ? 'is-partner' : ''].filter(Boolean).join(' ')}
                  title={`${w.shuku[i]} · ${rel(chart.ring[i])}`}>
                  <span className="xtell-sk-shuku">{one[i]}</span>
                  <span className="xtell-sk-r">{rel(chart.ring[i])}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.sk.legend')}</p>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.sk.note')}</p>
    </div>
  )
}

/** 九星気学 (Sep 29): the stars, then this year's or month's board as a
 *  Japanese 九星 chart draws it (南 on top), each direction marked with the
 *  school's unlucky names or as good; the numbers come from lib/kyusei.ts. */
function KyuseiBoard({ chart }: { chart: any }) {
  const { lang, t } = useLang()
  const [which, setWhich] = useState<'year' | 'month'>('year')
  if (!chart?.honmei || !chart?.year) return null
  const w = kyWords(lang)
  const d = chart[which]
  const disc = (n: number, size: number) => (
    <span className="xtell-ky-disc" style={{ width: size, height: size, background: STAR_COLOR[n], color: STAR_LIGHT[n] || n === 5 ? '#2b2622' : '#faf6ed', border: STAR_LIGHT[n] ? '1.5px solid #2b2622' : 'none', fontSize: size * 0.42 }}>{w.short[n].slice(0, lang === 'en' ? 1 : 1)}</span>
  )
  const tags = (dir: string): Array<{ k: string; bad: boolean }> => {
    const out: Array<{ k: string; bad: boolean }> = []
    for (const k of ['goou', 'anken', 'ha', 'honmei', 'honmeiTeki'] as const) if (d[k] === dir) out.push({ k, bad: true })
    if (!out.length && d.best?.includes(dir)) out.push({ k: 'best', bad: false })
    else if (!out.length && d.good?.includes(dir)) out.push({ k: 'good', bad: false })
    return out
  }
  const list = (dirs: string[]) => dirs.length ? dirs.map(x => w.dir[x as keyof typeof w.dir]).join(lang === 'en' ? ', ' : '・') : t('xtell.ky.none')
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="xtell-ky-stars">
        <div>{disc(chart.honmei, 34)}<span><small>{t('xtell.ky.honmei')}</small>{w.star[chart.honmei]}</span></div>
        <div>{disc(chart.getsumei, 34)}<span><small>{t('xtell.ky.getsumei')}</small>{w.star[chart.getsumei]}</span></div>
      </div>
      {chart.boundary?.year ? <p className="xtell-ky-note">{t('xtell.ky.boundaryYear').replace('{alt}', w.star[chart.boundary.year])}</p> : null}
      {chart.boundary?.month ? <p className="xtell-ky-note">{t('xtell.ky.boundaryMonth').replace('{alt}', w.star[chart.boundary.month])}</p> : null}
      <div className="xtell-ky-tabs" role="tablist">
        {(['year', 'month'] as const).map(k => (
          <button key={k} type="button" role="tab" aria-selected={which === k} onClick={() => setWhich(k)}>{t(`xtell.ky.${k}`)}</button>
        ))}
        <span className="xtell-ky-asof">{t('xtell.ky.asOf').replace('{date}', chart.today)}</span>
      </div>
      <div className="xtell-ky-board" role="table" aria-label={t(`xtell.ky.${which}`)}>
        {BOARD_LAYOUT.map((row, i) => (
          <div key={i} role="row" className="xtell-ky-row">
            {row.map(dir => {
              const n = d.board[dir]
              const tg = dir === 'C' ? [] : tags(dir)
              return (
                <div key={dir} role="cell" className={['xtell-ky-cell', dir === 'C' ? 'is-center' : '', tg.some(x => x.bad) ? 'is-bad' : tg.length ? 'is-good' : '', n === chart.honmei ? 'is-own' : ''].filter(Boolean).join(' ')}>
                  <span className="xtell-ky-dir">{w.dir[dir]}</span>
                  {disc(n, 30)}
                  <span className="xtell-ky-name">{w.short[n]}</span>
                  {tg.map(x => <span key={x.k} className={x.bad ? 'xtell-ky-tag is-bad' : 'xtell-ky-tag is-good'}>{w.tag[x.k as keyof typeof w.tag]}</span>)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <dl className="xtell-ky-sum">
        <div><dt>{t('xtell.ky.bad')}</dt><dd>{list(d.bad ?? [])}</dd></div>
        <div><dt>{t('xtell.ky.good')}</dt><dd>{d.blocked ? t('xtell.ky.blocked') : list(d.good ?? [])}</dd></div>
      </dl>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.ky.note')}</p>
    </div>
  )
}

function NavagrahaBoard({ chart }: { chart: any }) {
  const t = useT()
  const { lang } = useLang()
  const dms = (d: number) => `${Math.floor(d)}°${String(Math.round((d % 1) * 60)).padStart(2, '0')}'`
  const rasi = (i: number) => rasiName(t, lang, i)
  const nak = (i: number, pada: number) => `${NAKSHATRA[i][0]} ${nakName(lang, i)} ${pada}`
  const ymd = (s: string) => String(s).slice(0, 10)
  const nowId = chart.dasha?.current ? `${chart.dasha.current.lord}${chart.dasha.current.from}` : ''
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        {String(chart.utc).replace('T', ' ').slice(0, 16)} UTC · {chart.place} · Lahiri {Number(chart.ayanamsa).toFixed(2)}°
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ ...mono, color: 'var(--muted2)' }}>{t('xtell.lagna')}</span>
        <span style={{ fontFamily: 'var(--font-display), serif', fontSize: 22, fontWeight: 800 }}>{rasi(chart.lagna.rasi)} {dms(chart.lagna.deg)}</span>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{nak(chart.lagna.nakshatra, chart.lagna.pada)}</span>
      </div>
      <p className="xtell-scroll-hint" aria-hidden="true">{t('xtell.scrollHint')}</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
          <thead>
            <tr style={{ ...mono, color: 'var(--muted2)', textAlign: 'left' }}>
              {[t('xtell.nav.col.graha'), t('xtell.nav.col.sign'), t('xtell.nav.col.deg'), t('xtell.nav.col.house'), 'Nakshatra · pada', 'D9'].map(h => <th key={h} style={{ padding: '4px 10px 6px 0', fontWeight: 500 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {chart.grahas.map((g: any) => (
              <tr key={g.graha} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 10px 6px 0', fontWeight: 700 }}>{grahaName(t, g.graha)} <span style={{ color: 'var(--muted2)', fontWeight: 400 }}>{GRAHA_SA[g.graha as keyof typeof GRAHA_SA]}</span></td>
                <td style={{ padding: '6px 10px 6px 0' }}>{rasi(g.rasi)}</td>
                <td style={{ padding: '6px 10px 6px 0', fontFamily: 'var(--font-mono), monospace' }}>{dms(g.deg)}{g.retro && g.graha !== 'Rahu' && g.graha !== 'Ketu' ? ' R' : ''}</td>
                <td style={{ padding: '6px 10px 6px 0', fontFamily: 'var(--font-mono), monospace' }}>{g.house}</td>
                <td style={{ padding: '6px 10px 6px 0' }}>{nak(g.nakshatra, g.pada)}</td>
                <td style={{ padding: '6px 10px 6px 0' }}>{rasi(g.navamsa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ ...mono, color: 'var(--muted2)', margin: '14px 0 6px' }}>{t('xtell.dasha')}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {chart.dasha.maha.map((p: any) => {
          const now = `${p.lord}${p.from}` === nowId
          return (
            <span key={p.from} style={{
              padding: '4px 10px', borderRadius: 999, fontSize: 12,
              border: '1px solid ' + (now ? 'var(--red)' : 'var(--border2)'), color: now ? 'var(--red)' : 'var(--muted)', fontWeight: now ? 700 : 400,
            }}>{grahaName(t, p.lord)} {ymd(p.from).slice(0, 4)}–{ymd(p.to).slice(0, 4)}{now ? ` · ${t('xtell.dasha.now')}` : ''}</span>
          )
        })}
      </div>
      {chart.dasha.currentAntar && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>
          {t('xtell.dasha.now')}：{grahaName(t, chart.dasha.current.lord)} / {grahaName(t, chart.dasha.currentAntar.lord)}　{ymd(chart.dasha.currentAntar.from)} – {ymd(chart.dasha.currentAntar.to)}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t('xtell.nav.note')}</div>
    </div>
  )
}

// ── 占星塔 ─────────────────────────────────────────────────────────────────

function PlaceRow({ label, value, onChange, sel, aria }: { label?: string; value: string; onChange: (v: string) => void; sel: any; aria?: FieldAria }) {
  const t = useT()
  const { lang } = useLang()
  return (
    <div className="xtell-place-row" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, marginLeft: 62 }}>
      <span style={{ fontSize: 12, color: 'var(--muted2)' }} aria-hidden="true">{t('xtell.place')}</span>
      <select aria-label={`${label ?? ''} ${t('xtell.place')}`.trim()} aria-invalid={aria?.invalid || undefined} aria-describedby={aria?.invalid ? aria.describedBy : undefined} style={sel} value={value} onChange={e => onChange(e.target.value)}>
        {placesFor(lang).map(p => <option key={p.key} value={p.key}>{placeLabel(p, lang)}</option>)}
      </select>
    </div>
  )
}

// Sign and planet names in the page's language (a Japanese tester, Sep 29:
// 「處女座」「巨蟹座」「月亮」 on a Japanese page). The engine keeps its Chinese
// names for the teacher's facts; the board reads the string table.
type Tr = (k: string) => string
const sign = (t: Tr, i: number) => t(`xtell.sign.${i}`)
// Relation words the engine writes in 繁體 for the teacher's facts (合盤
// rows, 流年), shown in the page's language (a Japanese tester, Sep 29:
// 「無特殊關係」「兩盤合看涵蓋」 on a Japanese page).
const REL_WORDS: Record<string, Array<[string | RegExp, string]>> = {
  ja: [['無特殊關係', '特別な関係なし'], ['無法判讀', '判定できません'], ['天干五合', '干合'], [/同為(.)/, 'どちらも$1'], [/(.)生(.)/, '$1生$2（相生）'], [/(.)剋(.)/, '$1剋$2（相剋）'], ['兔', '兎'], ['龍', '竜'], ['雞', '鶏'], ['豬', '猪'], ['猴', '猿'], ['狗', '犬'], ['　或　', '　または　'],
    [/兩盤合看涵蓋 (.+?)（(\d)\/5）/, '二人の命式を合わせると $1（$2/5）']],
  'zh-Hans': [['無特殊關係', '无特殊关系'], ['無法判讀', '无法判读'], [/同為(.)/, '同为$1'], [/(.)剋(.)/, '$1克$2'], ['兩盤合看涵蓋', '两盘合看涵盖'], ['龍', '龙'], ['雞', '鸡'], ['豬', '猪'], ['馬', '马'], ['　或　', '　或　']],
  ko: [['無特殊關係', '특별한 관계 없음'], ['無法判讀', '판정 불가'], ['天干五合', '천간합'], [/同為(.)/, '둘 다 $1'], ['　或　', ' 또는 '], [/兩盤合看涵蓋 (.+?)（(\d)\/5）/, '두 명식을 합치면 $1 ($2/5)']],
  en: [['無特殊關係', 'no special relation'], ['無法判讀', 'cannot be read'], ['天干五合', 'stem harmony'], [/同為(.)/, 'both $1'], [/(.)生(.)/, '$1 feeds $2'], [/(.)剋(.)/, '$1 restrains $2'], ['六合', 'Six Harmony'], ['三合', 'Three Harmony'], ['六沖', 'Clash'], ['相害', 'Harm'], ['相刑', 'Punishment'], ['　或　', ' or '],
    [/兩盤合看涵蓋 (.+?)（(\d)\/5）/, 'together the two charts cover $1 ($2/5)']],
}
/** The year's branch against the birth year's (太歲), per page language. */
const TAI_SUI: Record<string, Record<string, string>> = {
  ja: { 值太歲: '生まれ年と同じ支（値太歳）', 沖太歲: '冲太歳', 刑太歲: '刑太歳', 害太歲: '害太歳', 合太歲: '合太歳' },
  'zh-Hans': { 值太歲: '值太岁', 沖太歲: '冲太岁', 刑太歲: '刑太岁', 害太歲: '害太岁', 合太歲: '合太岁' },
  ko: { 值太歲: '태어난 해와 같은 지지 (치태세)', 沖太歲: '충태세', 刑太歲: '형태세', 害太歲: '해태세', 合太歲: '합태세' },
  en: { 值太歲: 'same branch as the birth year (Tai Sui year)', 沖太歲: 'clashes with Tai Sui', 刑太歲: 'punishes Tai Sui', 害太歲: 'harms Tai Sui', 合太歲: 'in harmony with Tai Sui' },
}
const relText = (lang: string, s: unknown): string => {
  let out = String(s ?? '')
  for (const [a, b] of REL_WORDS[lang] ?? []) out = typeof a === 'string' ? out.split(a).join(b) : out.replace(a, b)
  return out
}
/** The engines write the lunar date in Chinese numerals (「一九九二年三月
 *  十三」, 「冬月廿七」, 「臘月初五」). Pages that are not Chinese show it in
 *  figures; a string this cannot read is shown as it is. */
const CN_DIGIT: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_MONTH: Record<string, number> = { 正: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 冬: 11, 十二: 12, 臘: 12, 腊: 12 }
function lunarLocal(lang: string, s: unknown): string {
  const raw = String(s ?? '')
  if (lang === 'zh-Hant' || lang === 'zh-Hans') return raw
  const m = raw.match(/^([〇零一二三四五六七八九]{4})年(閏|闰)?(正|冬|臘|腊|十[一二]?|[一二三四五六七八九])月(初[一二三四五六七八九十]|十[一二三四五六七八九]?|二十|廿[一二三四五六七八九]?|三十|卅)$/)
  if (!m) return raw
  const year = [...m[1]].map(c => CN_DIGIT[c]).join('')
  const month = CN_MONTH[m[3]]
  const d = m[4]
  const day = d.startsWith('初') ? (d[1] === '十' ? 10 : CN_DIGIT[d[1]])
    : d === '二十' ? 20 : d === '三十' || d === '卅' ? 30
    : d.startsWith('廿') ? 20 + (CN_DIGIT[d[1]] ?? 0)
    : 10 + (CN_DIGIT[d[1]] ?? 0)
  if (lang === 'ja') return `旧暦${year}年${m[2] ? '閏' : ''}${month}月${day}日`
  if (lang === 'ko') return `음력 ${year}년 ${m[2] ? '윤' : ''}${month}월 ${day}일`
  return `lunar ${year}-${m[2] ? 'leap ' : ''}${month}-${day}`
}
/** 納音 as Japanese 四柱推命 books write them (剣鋒金, 炉中火 …); the
 *  engine's are 繁體. Only the nine that differ. */
const NAYIN_JA: Record<string, string> = { 劍鋒金: '剣鋒金', 爐中火: '炉中火', 覆燈火: '覆灯火', 大溪水: '大渓水', 大驛土: '大駅土', 白蠟金: '白鑞金', 路旁土: '路傍土', 石榴木: '柘榴木', 沙中金: '砂中金' }
const naYinLocal = (lang: string, s: string) => (lang === 'ja' ? NAYIN_JA[s] ?? s : s)
/** 媽祖's line in place of a grade: 「屬金利秋 宜其西方」 (the stick's 五行,
 *  its season and its direction), in the page's language. */
function mazuLuck(t: Tr, lang: string, luck: unknown): string {
  const raw = String(luck ?? '')
  if (lang === 'zh-Hant') return raw
  const m = raw.match(/^屬(.)利(.)\s+宜其(.+)$/)
  return m ? t('xtell.qian.mazu.luck').replace('{el}', t(`xtell.el.${m[1]}`)).replace('{season}', t(`xtell.qian.mazu.season.${m[2]}`)).replace('{dir}', t(`xtell.qian.mazu.dir.${m[3]}`)) : raw
}
const plName = (t: Tr, k: string) => (k in PLANET_ZH || k in POINT_ZH ? t(`xtell.pl.${k}`) : k)
// 九曜: the rasi keep their Chinese names on 繁體 pages (白羊, not 牡羊座),
// elsewhere the page's own sign names; the grahas and the mansions likewise.
const rasiName = (t: Tr, lang: string, i: number) => (lang === 'zh-Hant' ? RASI[i][1] : t(`xtell.sign.${i}`))
const grahaName = (t: Tr, g: string) => t(`xtell.pl.${g}`)
const nakName = (lang: string, i: number) => { const n = `${NAKSHATRA[i][1]}宿`; return lang === 'ja' ? n.replace('參', '参').replace('虛', '虚') : n }
/** One sign, or both of a transition day's when the hour is unknown. Reads
 *  the engine's daySigns; `moonSigns` is the short-lived earlier shape of the
 *  same idea, still on a few saved charts. */
const signsOfC = (c: any, body: string): number[] => {
  const two = c?.daySigns?.[body] ?? (body === 'Moon' ? c?.moonSigns : undefined)
  if (Array.isArray(two) && two.length > 1) return two
  const p = c?.planets?.find((x: any) => x.body === body)
  return p ? [p.sign] : []
}
const signLabelC = (t: Tr, c: any, body: string) => signsOfC(c, body).map(i => sign(t, i)).join(' / ')
const dms = (d: number) => `${Math.floor(d)}°${String(Math.floor((d % 1) * 60)).padStart(2, '0')}'`
const nameOf = (t: Tr, k: string) => plName(t, k)
const glyphOf = (k: string) => (PLANET_GLYPH as any)[k] ?? ''

/** One aspect as a chip. The orb is on it because a 0.2° square and a 6.8°
 *  square are not the same statement, and the whole point of showing the
 *  chart is that the reading can be checked against it. */
function AspectChip({ a, prefix }: { a: any; prefix?: [string, string] }) {
  const t = useT()
  const tight = a.orb < 1
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 999,
      border: '1px solid ' + (tight ? 'var(--red)' : 'var(--border2)'), fontSize: 11.5,
      color: tight ? 'var(--red)' : 'var(--muted)', whiteSpace: 'nowrap',
    }}>
      <span>{prefix?.[0]}{nameOf(t, a.a)}</span>
      <span style={{ fontSize: 13 }}>{a.glyph}</span>
      <span>{prefix?.[1]}{nameOf(t, a.b)}</span>
      <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10, opacity: 0.75 }}>
        {a.orb.toFixed(1)}°{a.applying ? '→' : ''}
      </span>
    </span>
  )
}

function Bars({ title, data, keys, label = k => k }: { title: string; data: Record<string, number>; keys: readonly string[]; label?: (k: string) => string }) {
  const max = Math.max(1, ...keys.map(k => data[k] ?? 0))
  return (
    <div>
      <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', gap: 14 }}>
        {keys.map(k => (
          <div key={k} style={{ textAlign: 'center', minWidth: 34 }}>
            <div style={{ height: 44, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <div style={{
                width: 18, height: `${((data[k] ?? 0) / max) * 100}%`, minHeight: 2,
                background: (data[k] ?? 0) === 0 ? 'var(--border2)' : 'var(--red)', borderRadius: 3,
              }} />
            </div>
            <div style={{ fontSize: 11.5, marginTop: 4 }}>{label(k)}</div>
            <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted2)' }}>{data[k] ?? 0}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The natal board: what every room shows before its own extra. */
function NatalTable({ c, compact }: { c: any; compact?: boolean }) {
  const t = useT()
  // Older saved charts predate the flag and read as a known hour.
  const unknown = !!c.hourUnknown
  const sunSigns = signsOfC(c, 'Sun')
  // Bodies with two possible signs that day; the note under the cards names
  // them and says why (Codex QA: the slash had no explanation nearby).
  const twoBodies: string[] = unknown ? c.planets.filter((p: any) => signsOfC(c, p.body).length > 1).map((p: any) => plName(t, p.body)) : []
  const local = localStamp(String(c.utc), String(c.tz))
  // The answer to 「我是什麼星座」 comes first. The everyday 星座 is the Sun
  // sign; the Ascendant, which used to lead the board, was being read as the
  // answer (Codex QA, Sep 25).
  const big: Array<[string, string, string]> = [
    ['sun', signLabelC(t, c, 'Sun'), t('xtell.astro.sun.meaning')],
    ['moon', signLabelC(t, c, 'Moon'), t('xtell.astro.moon.meaning')],
    ['asc', unknown ? t('xtell.astro.needstime') : sign(t, Math.floor(c.angles.asc / 30)), t('xtell.astro.asc.meaning')],
  ]
  const planetTable = (<>
    <p className="xtell-scroll-hint" aria-hidden="true">{t('xtell.scrollHint')}</p>
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: unknown ? 340 : 420 }}>
        <thead>
          <tr style={{ ...mono, color: 'var(--muted2)', textAlign: 'left' }}>
            {[t('xtell.astro.body'), t('xtell.astro.sign'), t('xtell.astro.deg'), ...(unknown ? [] : [t('xtell.astro.house')])].map(h =>
              <th key={h} style={{ padding: '4px 14px 6px 0', fontWeight: 500 }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {c.planets.map((p: any) => (
            <tr key={p.body} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 14px 6px 0', fontWeight: 700 }}>
                <span style={{ color: 'var(--muted2)', fontWeight: 400, marginRight: 6 }}>{glyphOf(p.body)}</span>
                {plName(t, p.body)}
              </td>
              <td style={{ padding: '6px 14px 6px 0' }}>{signLabelC(t, c, p.body)}</td>
              <td style={{ padding: '6px 14px 6px 0', fontFamily: 'var(--font-mono), monospace' }}>
                {/* No noon degree for the Moon or a sign-crossing body when the hour is unknown. */}
                {unknown && (p.body === 'Moon' || signsOfC(c, p.body).length > 1) ? '—' : dms(p.deg)}{p.retro && p.body !== 'NorthNode' && p.body !== 'SouthNode' ? ' ℞' : ''}
              </td>
              {!unknown && <td style={{ padding: '6px 14px 6px 0', fontFamily: 'var(--font-mono), monospace' }}>{p.house}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>)
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display), serif', fontSize: compact ? 16 : 21, fontWeight: 800, lineHeight: 1.3 }}>
        {sunSigns.length > 1
          ? t('xtell.astro.sunsign.either').replace('{a}', sign(t, sunSigns[0])).replace('{b}', sign(t, sunSigns[1]))
          : t('xtell.astro.sunsign.is').replace('{sign}', sign(t, sunSigns[0]))}
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted2)', marginLeft: 8, fontFamily: 'var(--font-body), sans-serif' }}>{t('xtell.astro.sunsign.note')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(3, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, margin: '10px 0' }}>
        {big.map(([k, v, m]) => (
          <div key={k} style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '8px 12px', minWidth: 0 }}>
            <div style={{ ...mono, color: 'var(--muted2)' }}>{t('xtell.astro.big.' + k)}</div>
            <div style={{ fontFamily: 'var(--font-display), serif', fontSize: compact ? 15 : 18, fontWeight: 800 }}>{v}</div>
            {!compact && <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 2 }}>{m}</div>}
          </div>
        ))}
      </div>
      {twoBodies.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--white)', lineHeight: 1.6, margin: '-2px 0 8px' }}>
          {t('xtell.astro.daysigns.note').replace('{bodies}', twoBodies.join('、'))}
        </div>
      )}
      {/* The birth as entered: local wall time and place. UTC, which is what
          the ephemeris was read at, sits inside the full chart below. */}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        {local.stamp} · {c.place}（{local.offset}）{unknown ? ` · ${t('xtell.astro.unknown.short')}` : ''}
      </div>

      {compact ? planetTable : (
        <>
          <details>
            <summary style={{ ...mono, color: 'var(--muted2)', cursor: 'pointer' }}>{t('xtell.astro.full')}</summary>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                {String(c.utc).replace('T', ' ').slice(0, 16)} UTC · {c.system === 'placidus' ? 'Placidus' : t('xtell.astro.equal')}
              </div>
              {!unknown && (
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 12 }}>
                  {[['ASC', c.angles.asc], ['MC', c.angles.mc], ['Fortune', c.angles.fortune]].map(([k, v]: any) => (
                    <span key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                      <span style={{ ...mono, color: 'var(--muted2)' }}>{POINT_ZH[k as keyof typeof POINT_ZH]}</span>
                      <span style={{ fontFamily: 'var(--font-display), serif', fontSize: 19, fontWeight: 800 }}>{sign(t, Math.floor(v / 30))}</span>
                      <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--muted)' }}>{dms(v % 30)}</span>
                    </span>
                  ))}
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {t('xtell.astro.ruler')} {c.chartRuler ? plName(t, c.chartRuler) : '—'} · {t(`xtell.astro.sect.${c.sect}`)}
                  </span>
                </div>
              )}
              {planetTable}
              {!unknown && (
                <>
                  <div style={{ ...mono, color: 'var(--muted2)', margin: '16px 0 6px' }}>{t('xtell.astro.cusps')}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {c.cusps.map((x: number, i: number) => (
                      <span key={i} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border2)', fontSize: 11.5, color: 'var(--muted)' }}>
                        <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)' }}>{i + 1}</span>{' '}
                        {sign(t, Math.floor(x / 30))} {dms(x % 30)}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap', margin: '18px 0 4px' }}>
                <Bars title={t('xtell.astro.elements')} data={c.balance.elements} keys={ELEMENTS} label={k => t(`xtell.astro.el.${ELEMENTS.indexOf(k as any)}`)} />
                <Bars title={t('xtell.astro.modalities')} data={c.balance.modalities} keys={MODALITIES} label={k => t(`xtell.astro.mod.${MODALITIES.indexOf(k as any)}`)} />
              </div>
              <div style={{ ...mono, color: 'var(--muted2)', margin: '16px 0 6px' }}>{t('xtell.astro.aspects')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {/* The engine no longer emits angle or Moon aspects for an
                    unknown hour; the filter covers charts saved before it did. */}
                {c.aspects.filter((a: any) => !unknown || !/ASC|MC|Fortune|Moon/.test(`${a.a} ${a.b}`)).map((a: any, i: number) => <AspectChip key={i} a={a} />)}
              </div>
            </div>
          </details>
          <details style={{ marginTop: 8 }}>
            <summary style={{ ...mono, color: 'var(--muted2)', cursor: 'pointer' }}>{t('xtell.astro.glossary')}</summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
              {['house', 'placidus', 'ruler', 'sect', 'retro', 'aspects'].map(k => <li key={k}>{t('xtell.astro.gloss.' + k)}</li>)}
            </ul>
          </details>
        </>
      )}
    </div>
  )
}

/**
 * The board, one shape per room. Everything on it came out of lib/astrology.ts
 * and is checkable against any ephemeris — which is the whole reason it is
 * shown before the reading is bought.
 */
function ZhanxingBoard({ chart }: { chart: any }) {
  const t = useT()
  const c = chart?.natal
  if (!c) return null

  if (chart.mode === 'synastry' && chart.natal2 && chart.synastry) {
    const s = chart.synastry
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 22 }}>
          <div><div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.person1')}</div><NatalTable c={c} compact /></div>
          <div><div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.person2')}</div><NatalTable c={chart.natal2} compact /></div>
        </div>
        <div style={{ ...mono, color: 'var(--muted2)', margin: '18px 0 6px' }}>{t('xtell.astro.inter')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {s.inter.slice(0, 30).map((a: any, i: number) => <AspectChip key={i} a={a} prefix={['①', '②']} />)}
        </div>
        <div style={{ ...mono, color: 'var(--muted2)', margin: '18px 0 6px' }}>{t('xtell.astro.composite')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {s.composite.planets.slice(0, 10).map((p: any) => (
            <span key={p.body} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border2)', fontSize: 11.5, color: 'var(--muted)' }}>
              {glyphOf(p.body)} {plName(t, p.body)} {sign(t, p.sign)} {dms(p.deg)}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t('xtell.astro.synastry.note')}</div>
      </div>
    )
  }

  if (chart.mode === 'today' && chart.today) {
    const d = chart.today
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ ...mono, color: 'var(--muted2)' }}>{d.date}</span>
          <span style={{ fontSize: 13 }}>{t('xtell.astro.moontoday')} <b>{sign(t, d.moonSign)}</b></span>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {d.retro.length
              ? `${t('xtell.astro.retro')}：${d.retro.map((p: string) => plName(t, p)).join('、')}`
              : t('xtell.astro.noretro')}
          </span>
        </div>
        {/* An empty list is a real answer, and saying so is the difference
            between a transit reading and a horoscope column. */}
        {d.list.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: '14px 0' }}>{t('xtell.astro.notransits')}</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
            <thead>
              <tr style={{ ...mono, color: 'var(--muted2)', textAlign: 'left' }}>
                {[t('xtell.astro.transit'), t('xtell.astro.natalpt'), t('xtell.astro.orb'), t('xtell.astro.exact')].map(h =>
                  <th key={h} style={{ padding: '4px 12px 6px 0', fontWeight: 500 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.list.map((x: any, i: number) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 12px 6px 0' }}>
                    <b>{glyphOf(x.a)} {nameOf(t, x.a)}</b> <span style={{ color: 'var(--muted2)' }}>{sign(t, x.transitSign)} {dms(x.transitDeg)}{x.retro ? ' ℞' : ''}</span>
                  </td>
                  <td style={{ padding: '6px 12px 6px 0' }}>{x.glyph} {nameOf(t, x.b)}</td>
                  <td style={{ padding: '6px 12px 6px 0', fontFamily: 'var(--font-mono), monospace', color: x.orb < 0.3 ? 'var(--red)' : 'var(--muted)' }}>
                    {x.orb.toFixed(2)}°{x.applying ? ' →' : ''}
                  </td>
                  <td style={{ padding: '6px 12px 6px 0', fontFamily: 'var(--font-mono), monospace', color: 'var(--muted)' }}>{x.exact ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <details style={{ marginTop: 16 }}>
          <summary style={{ ...mono, color: 'var(--muted2)', cursor: 'pointer' }}>{t('xtell.astro.natalchart')}</summary>
          <div style={{ marginTop: 12 }}><NatalTable c={c} /></div>
        </details>
        <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t('xtell.astro.today.note')}</div>
      </div>
    )
  }

  if (chart.mode === 'year' && chart.year) {
    const { ret, prog, year } = chart.year
    return (
      <div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          {year} · {c.hourUnknown ? `${String(ret.utc).slice(0, 10)}（${t('xtell.astro.needstime')}）` : `${String(ret.utc).replace('T', ' ').slice(0, 16)} UTC`}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          <span style={{ ...mono, color: 'var(--muted2)' }}>{t('xtell.astro.srasc')}</span>
          {c.hourUnknown ? (
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('xtell.astro.needstime')}</span>
          ) : (
            <>
              <span style={{ fontFamily: 'var(--font-display), serif', fontSize: 20, fontWeight: 800 }}>{sign(t, Math.floor(ret.asc / 30))}</span>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--muted)' }}>{dms(ret.asc % 30)}</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* Saved charts from before the engine dropped the return Moon still carry it. */}
          {ret.planets.filter((p: any) => !(c.hourUnknown && p.body === 'Moon')).slice(0, 10).map((p: any) => (
            <span key={p.body} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border2)', fontSize: 11.5, color: 'var(--muted)' }}>
              {glyphOf(p.body)} {sign(t, p.sign)} {dms(p.deg)} {!c.hourUnknown && <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)' }}>H{p.house}</span>}
            </span>
          ))}
        </div>
        <div style={{ ...mono, color: 'var(--muted2)', margin: '18px 0 6px' }}>{t('xtell.astro.prog')}</div>
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          {t('xtell.astro.progsun')} <b>{sign(t, prog.sun.sign)} {c.hourUnknown ? `${Math.round(prog.sun.deg)}°` : `${prog.sun.deg.toFixed(1)}°`}</b>　·　
          {t('xtell.astro.progmoon')} <b>{sign(t, prog.moon.sign)}{c.hourUnknown ? '' : ` ${prog.moon.deg.toFixed(1)}°`}</b>
          {c.hourUnknown
            ? <span style={{ color: 'var(--muted)' }}> (±6°, {t('xtell.astro.needstime')})</span>
            : <span style={{ color: 'var(--muted)' }}> ({t('xtell.astro.house')} {prog.moon.house})</span>}
        </div>
        {prog.aspects.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {prog.aspects.map((a: any, i: number) => <AspectChip key={i} a={a} />)}
          </div>
        )}
        <details style={{ marginTop: 16 }}>
          <summary style={{ ...mono, color: 'var(--muted2)', cursor: 'pointer' }}>{t('xtell.astro.natalchart')}</summary>
          <div style={{ marginTop: 12 }}><NatalTable c={c} /></div>
        </details>
        <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t(c.hourUnknown ? 'xtell.astro.year.note.unknown' : 'xtell.astro.year.note')}</div>
      </div>
    )
  }

  return (
    <div>
      <NatalTable c={c} />
      <details style={{ marginTop: 8 }}>
        <summary style={{ ...mono, color: 'var(--muted2)', cursor: 'pointer' }}>{t('xtell.astro.method')}</summary>
        <div style={{ fontSize: 11.5, color: 'var(--muted2)', marginTop: 6, lineHeight: 1.6 }}>{t('xtell.astro.natal.note')}</div>
      </details>
    </div>
  )
}


// ── 姓名亭 ─────────────────────────────────────────────────────────────────

function NameForm({ surname, given, gender, onSurname, onGiven, onGender, sel, surnameAria, givenAria }: {
  surname: string; given: string; gender: 'male' | 'female'
  onSurname: (s: string) => void; onGiven: (s: string) => void; onGender: (g: 'male' | 'female') => void; sel: any
  surnameAria?: FieldAria; givenAria?: FieldAria
}) {
  const t = useT()
  const box = { ...sel, width: 96, fontSize: 18, fontFamily: 'var(--font-display), serif', letterSpacing: 4, textAlign: 'center' as const }
  const mark = (a?: FieldAria) => a?.invalid ? { 'aria-invalid': true as const, 'aria-describedby': a.describedBy, style: { ...box, borderColor: 'var(--red)' } } : { style: box }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700 }}>
          {t('xtell.surname')}
          {/* No length cap while typing: a Japanese or Korean IME holds the
              reading (さとう, 3 kana) before it becomes 佐藤, and cutting it at
              the limit broke the conversion. The length is checked on send. */}
          <input value={surname} onChange={e => onSurname(e.target.value)} {...mark(surnameAria)} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700 }}>
          {t('xtell.given')}
          <input value={given} onChange={e => onGiven(e.target.value)} {...mark(givenAria)} />
        </label>
        {(['male', 'female'] as const).map(g => (
          <label key={g} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
            <input type="radio" checked={gender === g} onChange={() => onGender(g)} />
            {t(`xtell.${g}`)}
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.name.note')}</div>
    </div>
  )
}

/** Every character with its 康熙 strokes and radical, the five grids with
 *  their 數理, and the 三才 line. All of it came out of lib/names.ts. */
function NameBoard({ chart }: { chart: any }) {
  const t = useT()
  const { lang } = useLang()
  const chinese = lang === 'zh-Hant' || lang === 'zh-Hans'
  // The old form beside a Japanese new-form kanji: Japanese pages only (余,
  // 台 and 体 are ordinary characters in a Chinese name).
  const showOld = lang === 'ja' && [...chart.surname, ...chart.given].some((c: any) => c.old)
  const sancaiKey = /兩處/.test(chart.sancai.label) ? 'bad' : /一處/.test(chart.sancai.label) ? 'mixed' : 'good'
  const luckColour: Record<string, string> = { 吉: 'var(--score-elite)', 半吉: 'var(--score-fair)', 凶: 'var(--score-poor)' }
  const chars = [...chart.surname, ...chart.given]
  const ge: any[] = Object.values(chart.ge)
  return (
    <div>
      <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 8 }}>{t('xtell.name.chars')}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {chars.map((c: any, i: number) => (
          <div key={i} style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 14px', textAlign: 'center', minWidth: 72 }}>
            <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 30, fontWeight: 800 }}>{c.ch}</div>
            <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 13, fontWeight: 700 }}>{c.strokes}</div>
            <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{c.kana ? t('xtell.name.kana') : `${c.radical}部`}</div>
            {showOld && c.old && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{t('xtell.name.old').replace('{ch}', c.old.ch).replace('{n}', String(c.old.strokes))}</div>}
          </div>
        ))}
      </div>
      {showOld && <p style={{ margin: '-6px 0 14px', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>{t('xtell.name.oldNote')}</p>}
      <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 8 }}>{t('xtell.name.grids')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
        {ge.map(g => (
          <div key={g.key} style={{ border: '1px solid ' + (g.key === 'ren' ? 'var(--red)' : 'var(--border2)'), borderRadius: 10, padding: '10px 12px', background: g.key === 'ren' ? 'var(--surface2)' : 'transparent' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b style={{ fontSize: 12.5 }}>{tOr(t, `xtell.name.ge.${g.key}`, g.label)}</b>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 20, fontWeight: 800 }}>{g.n}</span>
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <span style={{ color: 'var(--muted)' }}>{tOr(t, `xtell.el.${g.wuxing}`, g.wuxing)}　</span>
              <span style={{ fontWeight: 700, color: luckColour[g.shuli.luck] ?? 'var(--muted)' }}>{tOr(t, `xtell.name.luck.${g.shuli.luck}`, g.shuli.luck)}</span>
              {/* The 81 數理 keyword is a Chinese idiom (「寶馬金鞍」): Chinese pages only. */}
              <span style={{ color: 'var(--muted)' }}>　{chinese ? g.shuli.name : ''}{g.n !== g.shuli.n ? `（${g.shuli.n}）` : ''}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13 }}>
        <span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.name.sancai')}</span>
        <span style={{ color: 'var(--muted)' }}>{t('xtell.name.sancai.line')
          .replace('{a}', tOr(t, `xtell.el.${chart.sancai.tian}`, chart.sancai.tian)).replace(/\{b\}/g, tOr(t, `xtell.el.${chart.sancai.ren}`, chart.sancai.ren)).replace('{c}', tOr(t, `xtell.el.${chart.sancai.di}`, chart.sancai.di))
          .replace('{r1}', tOr(t, `xtell.name.rel.${chart.sancai.tianRen}`, chart.sancai.tianRen)).replace('{r2}', tOr(t, `xtell.name.rel.${chart.sancai.renDi}`, chart.sancai.renDi))}　{t(`xtell.name.sancai.${sancaiKey}`)}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t('xtell.name.source')}</div>
    </div>
  )
}

// ── 測字亭 ─────────────────────────────────────────────────────────────────

function CeziForm({ ch, setCh, ask, setAsk, sel, charAria }: { ch: string; setCh: (s: string) => void; ask: string; setAsk: (s: string) => void; sel: any; charAria?: FieldAria }) {
  const t = useT()
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700 }}>
          {t('xtell.cezi.char')}
          <input value={ch} maxLength={1} onChange={e => setCh(e.target.value.replace(/\s/g, '').slice(0, 1))} placeholder={t('xtell.cezi.char.ph')}
            aria-invalid={charAria?.invalid || undefined} aria-describedby={charAria?.invalid ? charAria.describedBy : undefined}
            style={{ ...sel, width: 72, fontSize: 28, fontFamily: 'var(--font-display), serif', textAlign: 'center', ...(charAria?.invalid ? { borderColor: 'var(--red)' } : {}) }} />
        </label>
        <input value={ask} onChange={e => setAsk(e.target.value.slice(0, 300))} placeholder={t('xtell.cezi.ask.ph')} aria-label={t('xtell.qian.ask')}
          style={{ ...sel, flex: 1, minWidth: 240 }} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.cezi.note')}</div>
    </div>
  )
}

function CeziBoard({ info, ask }: { info: any; ask: string }) {
  const t = useT()
  const { lang } = useLang()
  return (
    <div>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 72, fontWeight: 800, lineHeight: 1, padding: '10px 18px', background: 'var(--surface2)', borderRadius: 12 }}>{info.ch}</div>
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          <div><span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.cezi.radical')}</span>{info.radical}部（{info.radicalStrokes}{lang === 'ja' ? '画' : lang === 'zh-Hans' ? '画' : lang === 'ko' ? '획' : lang === 'en' ? ' strokes' : '畫'}）</div>
          <div><span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.name.chars')}</span>{info.strokes}</div>
          {lang === 'ja' && info.old && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('xtell.name.old').replace('{ch}', info.old.ch).replace('{n}', String(info.old.strokes))}</div>}
          {ask && <div><span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.qian.ask')}</span>{ask}</div>}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t('xtell.cezi.source')}</div>
    </div>
  )
}

// ── 解夢 ────────────────────────────────────────────────────────────────────
// The dream as the visitor tells it, and what they want to know. The book's
// lines come back from the chart route (lib/jiemeng.ts), shown free.
function DreamForm({ dream, setDream, ask, setAsk, sel, dreamAria }: { dream: string; setDream: (s: string) => void; ask: string; setAsk: (s: string) => void; sel: any; dreamAria?: FieldAria }) {
  const t = useT()
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label style={{ display: 'grid', gap: 6, fontSize: 12.5, fontWeight: 700 }}>
        {t('xtell.jiemeng.dream')}
        <textarea value={dream} rows={5} maxLength={DREAM_MAX} onChange={e => setDream(e.target.value.slice(0, DREAM_MAX))} placeholder={t('xtell.jiemeng.dream.ph')}
          aria-invalid={dreamAria?.invalid || undefined} aria-describedby={dreamAria?.invalid ? dreamAria.describedBy : undefined}
          style={{ ...sel, width: '100%', boxSizing: 'border-box', fontWeight: 400, lineHeight: 1.7, resize: 'vertical', ...(dreamAria?.invalid ? { borderColor: 'var(--red)' } : {}) }} />
      </label>
      <input value={ask} onChange={e => setAsk(e.target.value.slice(0, 300))} placeholder={t('xtell.jiemeng.ask.ph')} aria-label={t('xtell.jiemeng.ask')}
        style={{ ...sel, width: '100%', boxSizing: 'border-box' }} />
      <div style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.jiemeng.note')}</div>
    </div>
  )
}

// ── 孫子兵法 (Sep 29) ──────────────────────────────────────────────────────
// The situation as the visitor tells it, and the decision in front of them.
// The lines come back from the chart route (lib/sunzi.ts), shown free.
function SunziForm({ situation, setSituation, ask, setAsk, sel, situationAria }: { situation: string; setSituation: (s: string) => void; ask: string; setAsk: (s: string) => void; sel: any; situationAria?: FieldAria }) {
  const t = useT()
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label style={{ display: 'grid', gap: 6, fontSize: 12.5, fontWeight: 700 }}>
        {t('xtell.sunzi.situation')}
        <textarea value={situation} rows={5} maxLength={SITUATION_MAX} onChange={e => setSituation(e.target.value.slice(0, SITUATION_MAX))} placeholder={t('xtell.sunzi.situation.ph')}
          aria-invalid={situationAria?.invalid || undefined} aria-describedby={situationAria?.invalid ? situationAria.describedBy : undefined}
          style={{ ...sel, width: '100%', boxSizing: 'border-box', fontWeight: 400, lineHeight: 1.7, resize: 'vertical', ...(situationAria?.invalid ? { borderColor: 'var(--red)' } : {}) }} />
      </label>
      <input value={ask} onChange={e => setAsk(e.target.value.slice(0, 300))} placeholder={t('xtell.sunzi.ask.ph')} aria-label={t('xtell.sunzi.ask')}
        style={{ ...sel, width: '100%', boxSizing: 'border-box' }} />
      <div style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.sunzi.note')}</div>
    </div>
  )
}

// ── 塔羅 (Sep 28) ─────────────────────────────────────────────────────────────
// The browser deals (lib/tarot-draw.ts); the server lays the cards with their
// names, pictures and Waite's meaning for the way each landed (lib/tarot.ts).

function TarotPanel({ ask, setAsk, spread, setSpread, onDeal, entering, sel, extra }: {
  ask: string; setAsk: (s: string) => void; spread: TarotSpread; setSpread: (s: TarotSpread) => void
  onDeal: () => void; entering: boolean; sel: any
  /** Shown above the deal button: the personality-type box (Sep 30). */
  extra?: React.ReactNode
}) {
  const t = useT()
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label style={{ display: 'grid', gap: 6, fontSize: 12.5, fontWeight: 700 }}>
        {t('xtell.tarot.ask')}
        <input value={ask} onChange={e => setAsk(e.target.value.slice(0, 300))} placeholder={t('xtell.tarot.ask.ph')} disabled={entering}
          style={{ ...sel, width: '100%', boxSizing: 'border-box', fontWeight: 400 }} />
      </label>
      <div role="radiogroup" aria-label={t('xtell.tarot.spread')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, marginRight: 4 }}>{t('xtell.tarot.spread')}</span>
        {(['one', 'three'] as const).map(k => (
          <button key={k} type="button" role="radio" aria-checked={spread === k} disabled={entering} onClick={() => setSpread(k)}
            className={'xtell-tarot-spread' + (spread === k ? ' is-on' : '')}>
            {t(`xtell.tarot.spread.${k}`)}<small>{SPREADS[k].map(p => t(`xtell.tarot.pos.${p}`)).join(' · ')}</small>
          </button>
        ))}
      </div>
      {extra}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6, flex: 1, minWidth: 220 }}>{t('xtell.tarot.note')}</span>
        <button type="button" onClick={onDeal} disabled={entering} aria-busy={entering || undefined} className="xtell-tarot-deal">
          {entering ? t('xtell.tarot.drawing') : t('xtell.tarot.draw')}
        </button>
      </div>
    </div>
  )
}

function TarotBoard({ chart }: { chart: any }) {
  const t = useT()
  const { lang } = useLang()
  const cards: Array<{ id: string; reversed: boolean; position: string; names: Record<string, string>; image: string; meaning: string }> = Array.isArray(chart?.cards) ? chart.cards : []
  const name = (c: { names: Record<string, string> }) => c.names?.[lang] ?? c.names?.en ?? ''
  const turn = (c: { reversed: boolean }) => t(c.reversed ? 'xtell.tarot.reversed' : 'xtell.tarot.upright')
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...mono, color: 'var(--muted2)' }}>{t(`xtell.tarot.spread.${chart?.spread === 'three' ? 'three' : 'one'}`)}</span>
        {chart?.ask && <span style={{ fontSize: 13 }}>{chart.ask}</span>}
        <span style={{ flex: 1 }} />
        {cards.length > 0 && <ShareButton spec={() => ({ icon: 'tarot', link: 'tarot', title: t('xtell.site.focus.tarot.name'),
          kicker: t(`xtell.tarot.spread.${chart?.spread === 'three' ? 'three' : 'one'}`),
          body: cards.map(c => `${t(`xtell.tarot.pos.${c.position}`)}　${name(c)}（${turn(c)}）`), style: 'prose', name: 'xtell-tarot' })} />}
      </div>
      <div className={'xtell-tarot-cards' + (cards.length > 1 ? ' is-three' : '')}>
        {cards.map(c => (
          <figure key={c.id} className="xtell-tarot-card">
            <figcaption>{t(`xtell.tarot.pos.${c.position}`)}</figcaption>
            <img src={c.image} alt={name(c)} className={c.reversed ? 'is-reversed' : undefined} loading="lazy" />
            <strong>{name(c)}</strong>
            <span className={c.reversed ? 'is-reversed' : undefined}>{turn(c)}</span>
            <details>
              <summary>{t('xtell.tarot.meaning')}</summary>
              <p lang="en">{c.meaning}</p>
            </details>
          </figure>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.tarot.source')}</div>
    </div>
  )
}

// ── 幸運餅乾 (Sep 28) ─────────────────────────────────────────────────────────

function CookieForm({ food, setFood, mealAt, setMealAt, ask, setAsk, sel, foodAria, mealAria }: {
  food: string; setFood: (s: string) => void; mealAt: string; setMealAt: (s: string) => void
  ask: string; setAsk: (s: string) => void; sel: any; foodAria?: FieldAria; mealAria?: FieldAria
}) {
  const t = useT()
  const bad = (a?: FieldAria) => a?.invalid ? { 'aria-invalid': true as const, 'aria-describedby': a.describedBy } : {}
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label style={{ display: 'grid', gap: 6, fontSize: 12.5, fontWeight: 700 }}>
        {t('xtell.cookie.food')}
        <textarea value={food} rows={2} maxLength={FOOD_MAX} onChange={e => setFood(e.target.value.slice(0, FOOD_MAX))} placeholder={t('xtell.cookie.food.ph')} {...bad(foodAria)}
          style={{ ...sel, width: '100%', boxSizing: 'border-box', fontWeight: 400, lineHeight: 1.6, resize: 'vertical', ...(foodAria?.invalid ? { borderColor: 'var(--red)' } : {}) }} />
      </label>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, fontWeight: 700 }}>
        {t('xtell.cookie.when')}
        <input type="datetime-local" value={mealAt} onChange={e => setMealAt(e.target.value)} {...bad(mealAria)}
          style={{ ...sel, ...(mealAria?.invalid ? { borderColor: 'var(--red)' } : {}) }} />
      </label>
      <input value={ask} onChange={e => setAsk(e.target.value.slice(0, COOKIE_ASK_MAX))} placeholder={t('xtell.cookie.ask.ph')} aria-label={t('xtell.cookie.ask')}
        style={{ ...sel, width: '100%', boxSizing: 'border-box' }} />
    </div>
  )
}

function CookieBoard({ chart, readingId, onNote }: { chart: any; readingId: string | null; onNote: (note: string | null, fortune: string) => void }) {
  const { lang, t } = useLang()
  // The note is written after the slip is drawn (Sep 29) and streams in
  // here; a visit reopened before it was written asks for it then.
  const due = !!readingId && chart?.notePending === true && !chart?.note
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (!due) return
    let alive = true
    const ctl = new AbortController()
    const fortune = chart.fortune
    const finish = (note: string | null) => { if (alive) onNote(note, fortune) }
    void (async () => {
      setDraft('')
      // Another tab (or React's double effect in dev) may be writing it:
      // then the route says so and the saved note is asked for again.
      for (let tries = 0; tries < 8 && alive; tries++) {
        try {
          const res = await fetch('/api/xtell/cookie/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readingId }), signal: ctl.signal })
          if (!res.ok) return finish(null)
          if ((res.headers.get('content-type') ?? '').includes('ndjson')) {
            let raw = '', note: string | null = null
            await readNdjson(res, e => {
              if (!alive) return
              if (e.t === 'd') { raw += e.d; setDraft(raw) }
              else if (e.t === 'restart') { raw = ''; setDraft('') }
              else if (e.t === 'done') note = typeof e.note === 'string' ? e.note : null
            })
            return finish(note)
          }
          const d = await res.json().catch(() => null)
          if (!d?.writing) return finish(typeof d?.note === 'string' ? d.note : null)
          await new Promise(r => setTimeout(r, 3000))
        } catch { return finish(null) }
      }
      finish(null)
    })()
    return () => { alive = false; ctl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, readingId])
  if (!chart?.fortune) return null
  const noteDraft = due ? String(partialFields(draft).note ?? '').trim() : ''
  // The slip in the page's language (all five are saved with the cookie).
  const fortune: string = chart.fortunes?.[lang] ?? chart.fortune
  const facts = [t(`xtell.cookie.slot.${chart.meal?.slot ?? 'lunch'}`), chart.shichen, chart.dayGz ? `${chart.dayGz}日` : '', t('xtell.cookie.flavor').replace('{flavor}', chart.flavor).replace('{element}', chart.element)].filter(Boolean).join(' · ')
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13 }}>{chart.food}</span>
        <span style={{ flex: 1 }} />
        <ShareButton spec={() => ({ icon: 'cookie', link: 'cookie', title: t('xtell.site.focus.cookie.name'), kicker: facts,
          body: [fortune, ...(chart.note ? [chart.note] : [])], style: 'prose', name: 'xtell-cookie' })} />
      </div>
      <div className="xtell-cookie-slip">
        <p>{fortune}</p>
        {lang !== 'en' && chart.fortunes?.en && <p className="xtell-cookie-en" lang="en">{chart.fortunes.en}</p>}
      </div>
      {/* The slip is a classic fortune; this meal's taste, element, hour and
          day are in the note under it (owner, Sep 28). */}
      {(chart.note || due) && <div>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 4 }}>{t('xtell.cookie.noteLabel')}</div>
        {chart.note ? <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.8 }}>{chart.note}</p>
          : noteDraft ? <p className="xtell-caret" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.8 }}>{noteDraft}</p>
          : <WaitBar seconds={WAIT_SECONDS.note} label={t('xtell.cookie.noteWriting')} />}
      </div>}
      <div style={{ ...mono, color: 'var(--muted2)' }}>{facts}</div>
      {chart.charged > 0 && <div style={{ fontSize: 11.5, color: 'var(--muted2)' }}>{t('xtell.cookie.charged')}</div>}
      {chart.fortuneId != null && <div style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.cookie.source')}</div>}
    </div>
  )
}

// The situation, then Sunzi's lines: the original as written with its
// chapter, and the AI's plain translation under it, labelled as such.
function SunziBoard({ chart }: { chart: any }) {
  const t = useT()
  const { lang } = useLang()
  const hans = lang === 'zh-Hans'
  const lines: Array<{ id: number; chapter: string; chapterS: string; short: string; t: string; s: string; gloss: string }> = Array.isArray(chart?.lines) ? chart.lines : []
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 4 }}>{t('xtell.sunzi.yours')}</div>
        <div style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', background: 'var(--surface2)', borderRadius: 10, padding: '10px 14px' }}>{chart?.situation}</div>
        {chart?.ask && <div style={{ fontSize: 13, marginTop: 6 }}><span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.sunzi.ask')}</span>{chart.ask}</div>}
      </div>
      <div>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.sunzi.found')}</div>
        {lines.length ? (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {lines.map(l => (
              <li key={l.id} style={{ borderLeft: '3px solid var(--border2)', paddingLeft: 12 }}>
                <div lang={hans ? 'zh-Hans' : 'zh-Hant'} style={{ fontSize: 15.5, lineHeight: 1.75, fontFamily: 'var(--font-display), serif', fontWeight: 700, letterSpacing: '.03em' }}>
                  {hans ? l.s : l.t}
                  <span style={{ ...mono, fontSize: 11, fontWeight: 400, letterSpacing: 0, color: 'var(--muted2)', marginLeft: 8, whiteSpace: 'nowrap' }}>〈{hans ? (l.chapterS ?? l.chapter).replace(/第.+$/, '') : l.short}〉</span>
                </div>
                {l.gloss && <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--muted)', marginTop: 3 }}>
                  <span style={{ ...mono, fontSize: 10.5, color: 'var(--muted2)', marginRight: 6 }}>{t('xtell.sunzi.gloss')}</span>{l.gloss}
                </div>}
              </li>
            ))}
          </ol>
        ) : <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>{t('xtell.sunzi.none')}</p>}
        <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.sunzi.caveat')}</p>
      </div>
    </div>
  )
}

function DreamBoard({ chart }: { chart: any }) {
  const t = useT()
  const { lang } = useLang()
  const hans = lang === 'zh-Hans'
  const entries: Array<{ id: number; section: string; sectionS: string; t: string; s: string; gloss?: string }> = Array.isArray(chart?.entries) ? chart.entries : []
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 4 }}>{t('xtell.jiemeng.yours')}</div>
        <div style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', background: 'var(--surface2)', borderRadius: 10, padding: '10px 14px' }}>{chart?.dream}</div>
        {chart?.ask && <div style={{ fontSize: 13, marginTop: 6 }}><span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.jiemeng.ask')}</span>{chart.ask}</div>}
      </div>
      <div>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.jiemeng.found')}</div>
        {entries.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {entries.map(e => (
              <li key={e.id} style={{ fontSize: 15, lineHeight: 1.7 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span lang={hans ? 'zh-Hans' : 'zh-Hant'} style={{ fontFamily: 'var(--font-display), serif', fontWeight: 700, letterSpacing: '.06em' }}>{hans ? e.s : e.t}</span>
                  <span style={{ ...mono, fontSize: 11, color: 'var(--muted2)' }}>〔{hans ? e.sectionS : e.section}〕</span>
                </div>
                {/* The AI's translation of the line, on pages that are not Chinese. */}
                {e.gloss && <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--muted)' }}>
                  <span style={{ ...mono, fontSize: 10.5, color: 'var(--muted2)', marginRight: 6 }}>{t('xtell.sunzi.gloss')}</span>{e.gloss}
                </div>}
              </li>
            ))}
          </ul>
        ) : <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>{t('xtell.jiemeng.none')}</p>}
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.jiemeng.caveat')}</p>
      </div>
    </div>
  )
}


// ── Waiting for the first token ─────────────────────────────────────────────
// A reasoning model can sit for ten or twenty seconds before its first
// delta, and a static "…" read as a crash (owner, Sep 24, with a screenshot).
// Three breathing dots, the master's name, and after a few seconds the
// elapsed time so the wait is visibly alive.
function Thinking({ name }: { name?: string }) {
  const t = useT()
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const id = setInterval(() => setSecs(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted)', fontSize: 13 }} role="status" aria-live="polite">
      <span className="xtell-think" aria-hidden="true"><i /><i /><i /></span>
      <span>{t('xtell.thinking')}{name ? `　${name}` : ''}{secs >= 4 ? `　${secs}s` : ''}</span>
    </div>
  )
}


// ── This temple's history ───────────────────────────────────────────────────
// The visitor's saved visits to THIS temple (supabase/105, owner RLS), shown
// under the entry form so a returning visitor continues instead of recasting.
function TempleHistory({ temple, onResume }: { temple: Temple; onResume: (r: SavedReading) => void }) {
  const { lang, t } = useLang()
  const [rows, setRows] = useState<Array<SavedReading & { title: string | null; cost_cents: number; created_at: string }>>([])
  const [loaded, setLoaded] = useState(false)
  // Deleting is permanent, so it asks once, in the row itself.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // 改標題 (owner, Sep 28): the row being renamed, edited in place.
  const [renaming, setRenaming] = useState<string | null>(null)
  const client = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
  useEffect(() => {
    let active = true
    void (async () => {
      const sb = client()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { if (active) setLoaded(true); return }
      const { data } = await sb.from('xtell_readings')
        .select('id, temple, subject, chart, extras, turns, title, cost_cents, created_at')
        .eq('user_id', user.id).in('temple', DAILY_HOME.includes(temple) ? [temple, 'daily'] : [temple]).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(12)
      // 今日運勢 follow-ups live in the temple they were continued in:
      // 西洋占星's in 占星塔, 八字流日's in 八字廟 (owner, Sep 28).
      const mine = (data ?? []).filter((r: any) => r.temple === temple || dailyTemple(r.subject?.method) === temple).slice(0, 5)
      if (active) { setRows(mine as any); setLoaded(true) }
    })()
    return () => { active = false }
  }, [temple])
  const remove = async (id: string) => {
    setConfirming(null)
    if (await eraseReading(client(), id)) { setFailed(null); setRows(rs => rs.filter(r => r.id !== id)) }
    else setFailed(id)
  }
  const rename = async (id: string, text: string) => {
    if (!(await renameReading(client(), id, text))) return false
    setRows(rs => rs.map(r => (r.id === id ? { ...r, title: cleanTitle(text) } : r)))
    setRenaming(null)
    return true
  }
  if (!loaded || rows.length === 0) return null
  // One line per visit (owner, Sep 27: "too many info"): what it was about,
  // when, Continue, Delete. Its own card under the form, rows ruled apart.
  const when = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString(lang, { ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  }
  return (
    <section aria-labelledby="xtell-history-title" className="xtell-history" style={{ ...card, marginTop: 16, padding: '14px 18px 6px' }}>
      <h2 id="xtell-history-title" style={{ ...mono, fontSize: 11, fontWeight: 600, color: 'var(--muted2)', margin: '0 0 4px' }}>{t('xtell.history.temple')}</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r, i) => {
          const title = r.temple === 'daily'
            ? t('xtell.dy.visit').replace('{date}', String(r.subject?.date ?? '')).replace('{method}', t(`xtell.dy.${r.subject?.method === 'bazi' ? 'bazi' : 'western'}`))
            : r.title || firstAsk(r.turns) || describeVisit(t, temple, r.subject) || t(notAskedKey(temple))
          if (renaming === r.id) return (
            <li key={r.id} style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
              <TitleEditor value={r.title ?? ''} onSave={text => rename(r.id, text)} onCancel={() => setRenaming(null)} />
            </li>
          )
          return (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', fontSize: 13.5, borderTop: i ? '1px solid var(--border)' : 'none', flexWrap: confirming === r.id || failed === r.id ? 'wrap' : 'nowrap' }}>
              <span title={title} style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
              {confirming === r.id ? (
                <span role="group" aria-label={t('xtell.saved.deleteConfirm')} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--red)' }}>{t('xtell.saved.deleteConfirm')}</span>
                  <button type="button" onClick={() => void remove(r.id)} style={{ padding: '5px 12px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('xtell.saved.deleteYes')}</button>
                  <button type="button" onClick={() => setConfirming(null)} style={{ border: 'none', background: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xtell.saved.deleteNo')}</button>
                </span>
              ) : (<>
                <span style={{ ...mono, fontSize: 11.5, color: 'var(--muted2)', whiteSpace: 'nowrap' }}>{when(r.created_at)}</span>
                <button type="button" onClick={() => onResume(r)} style={{ flexShrink: 0, padding: '5px 14px', borderRadius: 999, border: '1px solid var(--red)', background: 'none', color: 'var(--red)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('xtell.saved.continue')}</button>
                {r.temple !== 'daily' && <button type="button" onClick={() => { setConfirming(null); setRenaming(r.id) }} style={{ flexShrink: 0, border: 'none', background: 'none', color: 'var(--muted2)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xtell.saved.rename')}</button>}
                <button type="button" onClick={() => { setFailed(null); setConfirming(r.id) }} style={{ flexShrink: 0, border: 'none', background: 'none', color: 'var(--muted2)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xtell.saved.delete')}</button>
              </>)}
              {failed === r.id && <span role="alert" style={{ flexBasis: '100%', fontSize: 12, color: 'var(--red)' }}>{t('xtell.saved.deleteFailed')}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
