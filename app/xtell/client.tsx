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
import { TEMPLES, PURPOSES } from '../components/xtell/TempleStreet'
import { TempleArtwork } from '../components/xtell/TempleArtwork'
import { XTellFooter } from '../components/xtell/XTellNav'
import { createBrowserClient } from '@supabase/ssr'
import { useT, useLang, tOr } from '../../lib/i18n'
import { birthProblem, daysInMonth, birthYears, REMEMBER_KEY, rememberedBirth } from '../../lib/xtell-birth'
import { useRequireAuth } from '../../lib/useRequireAuth'
import ModelPickerDialog, { type PickerModel } from '../components/ModelPickerDialog'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '../../lib/markdown'
import ProviderLogo from '../components/ProviderLogo'
import { drawQian, throwJiao, cryptoRand, CONFIRM_THROWS, QIAN_COUNTS, type Jiao } from '../../lib/xtell-ritual'
import { OptPill, OptGroup, SLOT_COLORS, thinkingLabel } from '../components/OptControls'

import { PLACES, DEFAULT_PLACE } from '../../lib/xtell-places'
import { GRAHA_ZH, GRAHA_SA, RASI, NAKSHATRA } from '../../lib/jyotish'
import { PLANET_ZH, PLANET_GLYPH, POINT_ZH, SIGNS, ELEMENTS, MODALITIES, localStamp } from '../../lib/astrology'
import { throwCoins, valueOf, validLines, type Coin, type LineValue } from '../../lib/yijing-core'
import { YixueQuestion, YixueManualCast, YixueRitual, YixuePicker, YixueBoard } from '../components/xtell/Yixue'
import { describeVisit, eraseReading, notAskedKey } from '../../lib/xtell-history'
import { PRESETS, EST_PROMPT_TOKENS, EST_YIXUE_PROMPT_TOKENS, estimateReadingUsd, fmtUsd, levelsOf, defaultThinking } from '../../lib/xtell-presets'
import XTellAssistant from '../components/xtell/XTellAssistant'
import XTellDaily, { type SavedDaily } from '../components/xtell/XTellDaily'
import { AlmanacCard } from '../components/xtell/XTellToday'
import { liveFeature, type FeatureId } from '../../lib/xtell-catalog'
import { cleanQuestion, clearHandoff, readHandoff, sessionStore, writeHandoff, type Handoff } from '../../lib/xtell-handoff'
import { chengguTheme, CHENGGU_MIN, CHENGGU_MAX } from '../../lib/xtell-chenggu-reading'
import { weightText, monthZh, dayZh, ZHI_SPAN, type Chenggu, type ChengguLunar } from '../../lib/xtell-chenggu'

type Temple = 'bazi' | 'ziwei' | 'yuelao' | 'guandi' | 'mazu' | 'simianfo' | 'navagraha' | 'zhanxing' | 'xingming' | 'cezi' | 'yixue'
const isQian = (t: Temple) => t === 'guandi' || t === 'mazu'

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

// The house default master (owner, Sep 24): Qwen 3.8 Flash with thinking
// ON — native in the classics and the temples' language, first word in
// seconds even while reasoning, a hundredth of Sol's price. Max, then Sol,
// are the fallbacks if it ever leaves the catalog; the picker stays for
// anyone who wants another seat or a 合參.
const DEFAULT_MASTER = 'qwen3.8-flash'
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
  const needsBirth = !isQian(temple) && temple !== 'xingming' && temple !== 'cezi' && temple !== 'yixue'
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
    if (!/^[㐀-䶿一-鿿]{1,2}$/.test(String(subj?.surname ?? ''))) return 'surname_invalid'
    if (!/^[㐀-䶿一-鿿]{1,2}$/.test(String(subj?.given ?? ''))) return 'given_invalid'
  }
  if (temple === 'cezi' && !/^[㐀-䶿一-鿿]$/.test(String(subj?.ch ?? ''))) return 'char_invalid'
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
  if (code === 'place_invalid') return 'place'
  if (code === 'place2_invalid') return 'place2'
  return null
}

/** One line of what a consultation was cast from, shown where a paid
 *  question is written so the visitor can confirm it first. */
function subjectSummary(t: (k: string) => string, temple: Temple, subj: any): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const born = (b: any) => !b ? '' : `${b.y}-${pad(b.m)}-${pad(b.d)} ${b.hourUnknown ? t('xtell.hourunknown') : `${pad(b.h)}:${pad(b.mi)}`} · ${t(`xtell.${b.gender}`)}`
  const where = (k: unknown) => PLACES.find(p => p.key === k)?.label ?? ''
  if (temple === 'yuelao' || (temple === 'zhanxing' && subj.mode === 'synastry')) {
    return `${t('xtell.person1')} ${born(subj.birth)}${subj.place ? ` · ${where(subj.place)}` : ''}　${t('xtell.person2')} ${born(subj.birth2)}${subj.place2 ? ` · ${where(subj.place2)}` : ''}`
  }
  if (temple === 'xingming') return `${subj.surname ?? ''}${subj.given ?? ''} · ${t(`xtell.${subj.gender}`)}`
  if (temple === 'cezi') return `「${subj.ch ?? ''}」${subj.ask ? ` · ${String(subj.ask).slice(0, 40)}` : ''}`
  if (isQian(temple)) return subj.ask ? String(subj.ask).slice(0, 60) : ''
  return `${born(subj.birth)}${subj.place ? ` · ${where(subj.place)}` : ''}`
}
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const shichenOf = (h: number) => ZHI[h === 23 ? 0 : Math.floor((h + 1) / 2) % 12] + '時'

function RequireTempleAuth() { useRequireAuth(); return null }

export default function XTellClient({ standalone: standaloneOverride }: { standalone?: boolean }) {
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
  // The front-door guide's suggestion for the room being opened (standalone
  // street only): the feature and the question it prepared. Kept in this
  // tab's sessionStorage too (lib/xtell-handoff.ts), so it survives a reload
  // or the sign-in round trip; the room re-derives its mode from the catalog.
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  // The daily fortune on the street: the guide's "daily" button bumps the
  // signal (scroll there, open the form); a saved follow-up about a day's
  // reading, opened from history, is shown there too.
  const [dailySignal, setDailySignal] = useState(0)
  const [savedDaily, setSavedDaily] = useState<SavedDaily | null>(null)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('reading')
    if (!id) return
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    sb.from('xtell_readings').select('id, temple, subject, chart, extras, turns').eq('id', id).is('deleted_at', null).maybeSingle()
      .then(({ data }) => {
        if (data?.temple === 'daily') { setSavedDaily(data as SavedDaily); return }
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
    sync(false)
    const onHash = () => sync(true)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [standalone])
  // Resume from inside a temple (its history list): seed the room from the
  // saved row without a page load. Same path ?reading= takes.
  const resume = (row: SavedReading) => {
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
    chooseTemple(feature.temple)
  }
  const leaveRoom = () => {
    const store = sessionStore()
    if (store) clearHandoff(store)
    setHandoff(null)
    setReadingParam(null)
    setSaved(null)
    chooseTemple(null)
  }

  if (standalone) return <div className="xtell-site">
    <main id="xtell-main" className={'xtell-container' + (!temple ? ' xtell-explorer-container' : '')} tabIndex={-1}>
      {!temple ? <>
        {/* The guide first, then today (owner, Sep 27): the Chinese almanac
            on the left, the daily fortune on the right. The temples
            themselves are in the top bar. */}
        <XTellAssistant onOpen={openFromGuide} />
        <div className="xtell-today">
          <AlmanacCard />
          <XTellDaily openSignal={dailySignal} resume={savedDaily} onClearResume={() => { if (savedDaily) setReadingParam(null); setSavedDaily(null) }} />
        </div>
      </> : <>
        <XTellAuthGate />
        <TempleRoom key={temple + (saved?.id ?? '') + (handoff?.feature.temple === temple ? handoff.feature.id : '')} temple={temple} onBack={leaveRoom} standalone initial={saved?.temple === temple ? saved : null}
          handoff={saved?.temple === temple || handoff?.feature.temple !== temple ? null : handoff} onResume={resume} />
      </>}
      <p className="xtell-disclaimer">{t('xtell.disclaimer')}</p>
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
            {(['bazi', 'ziwei', 'yuelao', 'guandi', 'mazu', 'simianfo', 'navagraha', 'zhanxing', 'xingming', 'cezi', 'yixue'] as Temple[])
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
          <TempleRoom key={temple + (saved?.id ?? '')} temple={temple} onBack={() => { setReadingParam(null); setSaved(null); setTemple(null) }} initial={saved?.temple === temple ? saved : null} onResume={resume} />
        )}

        <div style={{ marginTop: 40, fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.disclaimer')}</div>
      </div>
    </div>
  )
}

function TempleRoom({ temple, onBack, standalone = false, initial = null, onResume, handoff = null }: { temple: Temple; onBack: () => void; standalone?: boolean; initial?: SavedReading | null; onResume?: (r: SavedReading) => void; handoff?: Handoff | null }) {
  const t = useT()
  // The site language rides with every reading so the master answers in it
  // (owner, Sep 24) — a Japanese visitor pressing the Chinese pre-filled
  // question still gets Japanese. The visitor writing in another language
  // still wins, per the prompt.
  const { lang } = useLang()
  // A reopened reading seeds every input from its saved subject, so the
  // requests it sends next are byte-for-byte what the original visit sent.
  const init = initial?.subject ?? {}
  const defaultBirth = { y: 1990, m: 1, d: 1, h: 12, mi: 0, gender: 'male' as 'male' | 'female', hourUnknown: false }
  const [birth, setBirth] = useState<typeof defaultBirth>({ ...defaultBirth, ...(init.birth ?? {}), ...(init.gender && !init.birth ? { gender: init.gender } : {}),
    // 紫微/九曜 hide the checkbox; a record saved with it set must reopen
    // with the hour selectable so the visitor can correct it.
    ...(HOUR_REQUIRED.includes(temple) ? { hourUnknown: false } : {}) })
  const [readingId, setReadingId] = useState<string | null>(initial?.id ?? null)
  // 月老廟 needs a second person. Defaults to the other gender purely as a
  // starting point — both rows are fully editable, a couple is whoever they are.
  const [birth2, setBirth2] = useState<typeof defaultBirth>({ ...defaultBirth, gender: 'female', ...(init.birth2 ?? {}) })
  const [entered, setEntered] = useState(!!initial)
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
  // 九曜廟: the birth place (a curated city key; coordinates + zone resolve server-side).
  const [place, setPlace] = useState(init.place ?? DEFAULT_PLACE)
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
  // The teacher must receive the same subject that produced the visible
  // board, even if an entry control was changed while its request loaded.
  const yixueSubject = useRef<Record<string, unknown> | null>(temple === 'yixue' && initial ? { temple, ...init } : null)
  const [place2, setPlace2] = useState(init.place2 ?? DEFAULT_PLACE)
  const [srYear, setSrYear] = useState(init.year ?? new Date().getFullYear())
  // Shown by default. The computed chart is the whole reason this page is not
  // just a chat window, and it was hidden behind a link nobody clicked.
  const [showChart, setShowChart] = useState(true)
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
  // The picker either adds a seat or replaces one (owner, Sep 24: the first
  // master must be changeable too, not only the second).
  const [picker, setPicker] = useState<null | { replace: string | null }>(null)
  // Per-seat settings, the way XCreate configures each slot: thinking level
  // (from the row's declared levels) and web search (where the row declares
  // the capability). Defaults are computed, so an untouched seat needs no
  // entry. Qwen Flash defaults to thinking ON (owner's default master; it
  // still answers in seconds); Qwen Max defaults to thinking OFF — its own
  // default sat 130 s before the first token on a 紫微 prompt.
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
  /** A preset seats its model first; a teacher already seated moves to the
   *  front instead of being seated twice. Only ever called from a click. */
  const choosePreset = (m: PickerModel) => setMasters(ms => ms[0]?.id === m.id ? ms
    : ms.some(x => x.id === m.id) ? [m, ...ms.filter(x => x.id !== m.id)]
    : ms.length ? [m, ...ms.slice(1)] : [m])
  const searchable = (m: PickerModel) => ((m.output_config?.text?.capabilities ?? []) as string[]).includes('web_search')
  const defaultOpts = (m: PickerModel): SeatOpts => ({ thinking: defaultThinking(m), search: false })
  const optsOf = (m: PickerModel): SeatOpts => seatOpts[m.id] ?? defaultOpts(m)
  const setOpts = (m: PickerModel, patch: Partial<SeatOpts>) => setSeatOpts(o => ({ ...o, [m.id]: { ...optsOf(m), ...patch } }))

  // One shared conversation. A question goes to every seated master or to
  // the ones the visitor picks (owner, Sep 27); it remembers both (`to`, and
  // `seats`: who was seated), so each master's thread holds only the
  // questions put to it, and a reopened visit re-seats the same table. A
  // question saved before this has neither and counts as asked of all.
  type Turn = { role: 'user'; content: string; to?: string[]; seats?: string[] } | { role: 'assistant'; content: string; modelId: string; name: string; provider: string; cost?: number }
  const idList = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
  const [turns, setTurns] = useState<Turn[]>(() => (initial?.turns ?? []).map((x: any) => x.role === 'user'
    ? { role: 'user', content: String(x.content ?? ''), to: idList(x.to), seats: idList(x.seats) }
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
        if (initial?.turns?.length) {
          const lastUser = initial.turns.map((x: any) => x.role).lastIndexOf('user')
          const ids: string[] = [...(idList(initial.turns[lastUser]?.seats) ?? [])]
          if (!ids.length) for (const x of initial.turns.slice(lastUser + 1)) if (x.role === 'assistant' && x.modelId && !ids.includes(x.modelId)) ids.push(x.modelId)
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
    isQian(temple) ? { temple, n: n ?? stick?.n, ask, name: bing.name.trim(), city: bing.city.trim(), ...(bing.withBirth ? { birth } : {}) }
    : temple === 'xingming' ? { temple, surname: surname.trim(), given: given.trim(), gender: birth.gender }
    : temple === 'cezi' ? { temple, ch: ch.trim(), ask }
    : temple === 'yixue' ? {
        temple, mode: yixueMode,
        ...(yixueMode === 'cast' ? { ask: ask.trim(), lines: castRef.current.values,
          ...(castRef.current.coins.length === 6 ? { coins: castRef.current.coins } : {}) }
          : yixueMode === 'lookup' ? { n: n ?? lookupN } : {}),
      }
    : temple === 'simianfo' ? { temple, birth, wishes }
    : temple === 'navagraha' ? { temple, birth, place }
    : temple === 'zhanxing' ? {
        temple, birth, place, mode: astroMode,
        ...(astroMode === 'synastry' ? { birth2, place2 } : {}),
        ...(astroMode === 'year' ? { year: srYear } : {}),
      }
    : { temple, birth, ...(temple === 'yuelao' ? { birth2 } : {}) }

  // 今日 is the one room someone comes back to daily, so the birth row is
  // restored from THEIR browser rather than retyped. Wrapped because a
  // private window or blocked site data makes localStorage throw on access,
  // not just return null.
  useEffect(() => {
    if (temple !== 'zhanxing') return
    try {
      const v = rememberedBirth(localStorage.getItem(REMEMBER_KEY))
      if (v) {
        setBirth(b => ({ ...b, y: v.y, m: v.m, d: v.d, h: v.h, mi: v.mi, hourUnknown: v.hourUnknown, gender: v.gender ?? b.gender }))
        if (v.place) setPlace(v.place)
      }
    } catch { /* no memory is fine; the form still works */ }
  }, [temple])

  const enter = async (n?: number): Promise<boolean> => {
    if (questionRequired && !input.trim()) return false
    if (temple === 'yixue') {
      if (yixueEntryPending.current) return false
      yixueEntryPending.current = true
      setYixueEntryBusy(true)
    }
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
    } catch (e: any) { fail(String(e?.message ?? e), e?.code); if (isQian(temple)) setRitualBoth('drawn'); return false }
    finally {
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

  // The ritual. Draw a stick, throw the blocks; three 聖筊 confirm and open
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
    const s = { n: drawQian(cryptoRand, temple === 'mazu' ? QIAN_COUNTS.mazu : QIAN_COUNTS.guandi), throws: [] as Jiao[] }
    stickRef.current = s; setStick(s); setRitualBoth('drawn'); clearErr()
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
    refreshToken.current++
    clearErr(); setEntered(false)
    if (isQian(temple)) { stickRef.current = null; setStick(null); setRitualBoth('idle') }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const chip = (on: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: busy ? 'default' : 'pointer',
    border: '1px solid ' + (on ? 'var(--red)' : 'var(--border2)'), background: on ? 'var(--surface2)' : '#ffffff',
    color: on ? 'var(--red)' : 'var(--muted)', fontWeight: on ? 700 : 500,
  })

  const send = async (fromButton = false) => {
    // Chart rooms allow a general reading. Teacher conversations require an
    // actual question; neither an empty click nor Enter may spend credits.
    const typed = input.trim()
    if ((!typed && (questionRequired || !fromButton)) || busy || masters.length === 0 || unverified || savedProblem) return
    const q = typed || t('xtell.question.general')
    const to = recipients.map(m => m.id), seats = masters.map(m => m.id)
    setInput(''); setBusy(true); clearErr()
    setTurns(ts => [...ts, { role: 'user', content: q, to, seats }])
    // One id per question: every master's request carries it, the server
    // stores the question once (xtell_append_turns dedupes on it).
    const qid = crypto.randomUUID()

    // The chosen masters answer concurrently; each gets its own thread: the
    // questions put to it and its own replies, so two masters never see each
    // other's answers or a question they were not asked.
    await Promise.all(recipients.map(async m => {
      const history = turnsRef.current
        .filter(tn => tn.role === 'user' ? !tn.to || tn.to.includes(m.id) : tn.modelId === m.id)
        .map(tn => ({ role: tn.role, content: tn.content }))
      const idx = pushAssistant(m)
      try {
        const res = await fetch('/api/xtell/reading', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(temple === 'yixue' ? yixueSubject.current ?? subject() : subject()), question: q, modelId: m.id, history, readingId, qid, to, seats,
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
    }))
    setBusy(false)
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
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
  const toOnly = (tn: Turn) => tn.role === 'user' && tn.to && tn.seats && tn.to.length < tn.seats.length ? tn.to.map(nameOf).filter(Boolean).join('、') : null

  const sel = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 13 }

  return (
    // The arena is 1200 wide because XBoard/XEval put tables in it. A birth
    // form and a reading are prose, so the room keeps its own 980 measure.
    <div className={standalone ? "xtell-room" : undefined} data-entered={entered || undefined} style={{ maxWidth: 980 }}>
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
        <ol className="xtell-room-steps" aria-label={t('xtell.site.navigation')}>
          {/* 01 the form, 02 the chart until the first question is sent, 03
              the conversation (owner, Sep 24: step 2 was never lit). */}
          {['details', 'result', 'conversation'].map((step, i) => <li key={step} aria-current={(!entered && i === 0) || (entered && turns.length === 0 && i === 1) || (entered && turns.length > 0 && i === 2) ? 'step' : undefined}><span>{String(i + 1).padStart(2, '0')}</span>{t(`xtell.site.${step}`)}</li>)}
        </ol>
      </> : <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 14px' }}>{t(`xtell.${temple}.name`)}</h2>}

      {!entered ? (
        <div className={standalone ? "xtell-entry-form" : undefined} style={{ ...card, padding: '18px 20px' }}>
          {standalone && <p className="xtell-form-note">{t('xtell.site.freeStep')}</p>}
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
          ) : isQian(temple) ? (
            <RitualPanel ask={ask} setAsk={setAsk} stick={stick} ritual={ritual} onDraw={draw} onThrow={throwBlocks}
              bing={bing} setBing={setBing} birth={birth} setBirth={setBirth} sel={sel} />
          ) : temple === 'xingming' ? (
            <NameForm surname={surname} given={given} gender={birth.gender}
              onSurname={setSurname} onGiven={setGiven} onGender={g => setBirth(b => ({ ...b, gender: g }))} sel={sel}
              surnameAria={fieldAria('surname')} givenAria={fieldAria('given')} />
          ) : temple === 'cezi' ? (
            <CeziForm ch={ch} setCh={setCh} ask={ask} setAsk={setAsk} sel={sel} charAria={fieldAria('char')} />
          ) : temple === 'yuelao' || (temple === 'zhanxing' && astroMode === 'synastry') ? (
            <>
              <BirthRow label={t('xtell.person1')} value={birth} onChange={setBirth} sel={sel} aria={fieldAria('birth')} />
              {temple === 'zhanxing' && <PlaceRow label={t('xtell.person1')} value={place} onChange={setPlace} sel={sel} aria={fieldAria('place')} />}
              <div style={{ height: 12 }} />
              <BirthRow label={t('xtell.person2')} value={birth2} onChange={setBirth2} sel={sel} aria={fieldAria('birth2')} />
              {temple === 'zhanxing' && <PlaceRow label={t('xtell.person2')} value={place2} onChange={setPlace2} sel={sel} aria={fieldAria('place2')} />}
            </>
          ) : (
            <BirthRow value={birth} onChange={setBirth} sel={sel} allowUnknown={!HOUR_REQUIRED.includes(temple)} aria={fieldAria('birth')} />
          )}
          {temple === 'simianfo' && <WishForm wishes={wishes} setWishes={setWishes} aria={fieldAria('wishes')} />}
          {temple === 'navagraha' && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }} aria-hidden="true">{t('xtell.place')}</span>
              <select aria-label={t('xtell.place')} aria-invalid={fieldAria('place').invalid || undefined} aria-describedby={fieldAria('place').describedBy} style={sel} value={place} onChange={e => setPlace(e.target.value)}>
                {PLACES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <span style={{ fontSize: 11, color: 'var(--muted2)', flex: 1, minWidth: 240 }}>{t('xtell.place.note')}</span>
            </div>
          )}
          {temple === 'zhanxing' && astroMode !== 'synastry' && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }} aria-hidden="true">{t('xtell.place')}</span>
              <select aria-label={t('xtell.place')} aria-invalid={fieldAria('place').invalid || undefined} aria-describedby={fieldAria('place').describedBy} style={sel} value={place} onChange={e => setPlace(e.target.value)}>
                {PLACES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
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
          {!isQian(temple) && !(temple === 'yixue' && yixueMode !== 'ask') && (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted2)' }}>{temple === 'xingming' || temple === 'cezi' || temple === 'yixue' ? '' : t('xtell.solar.note')}</div>
              <span style={{ flex: 1 }} />
              <button onClick={() => void enter()} disabled={temple === 'yixue' && (yixueEntryBusy || !input.trim())} style={{
                padding: '10px 26px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff',
                fontWeight: 700, fontSize: 13.5, cursor: questionRequired && (!input.trim() || yixueEntryBusy) ? 'not-allowed' : 'pointer', opacity: questionRequired && (!input.trim() || yixueEntryBusy) ? 0.5 : 1,
              }}>{t(temple === 'yixue' ? 'xtell.yixue.enter' : 'xtell.enter')}</button>
            </div>
          )}
          {errShown && <div id={errId} role="alert" style={{ marginTop: 10, color: 'var(--red)', fontSize: 12.5 }}>⚠ {errShown}</div>}
          {/* This temple's saved visits (owner, Sep 24: history in each
              temple, not only on the account page). Continue reopens the
              room in place with chart and conversation. */}
          {onResume && <TempleHistory temple={temple} onResume={onResume} />}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(() => {
            const offered = PRESETS.map(p => ({ key: p.key, model: p.models.map(n => catalog.find(r => r.model_name === n)).find(Boolean) }))
              .filter((p): p is { key: typeof PRESETS[number]['key']; model: PickerModel } => !!p.model)
            if (offered.length === 0 || savedProblem || unverified) return null
            const chars = turns.reduce((n, tn) => n + tn.content.length, 0) + input.length
            return (
              <div role="group" aria-label={t('xtell.preset.title')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ ...mono, color: 'var(--muted2)', marginRight: 2 }}>{t('xtell.preset.title')}</span>
                {offered.map(({ key, model }) => {
                  const on = masters[0]?.id === model.id
                  const usd = estimateReadingUsd(model, defaultOpts(model), chars, temple === 'yixue' ? EST_YIXUE_PROMPT_TOKENS : EST_PROMPT_TOKENS)
                  return (
                    <button key={key} type="button" aria-pressed={on} onClick={() => choosePreset(model)} disabled={busy} style={{
                      padding: '6px 12px', borderRadius: 999, fontSize: 12, cursor: busy ? 'wait' : 'pointer',
                      border: `1px solid ${on ? 'var(--red)' : 'var(--border2)'}`, background: on ? 'var(--surface2)' : 'transparent', color: 'var(--white)',
                    }}>
                      <b>{t(`xtell.preset.${key}`)}</b> · {model.display_name}{usd != null ? ` · ~${fmtUsd(usd)}` : ''}
                    </button>
                  )
                })}
              </div>
            )
          })()}
          {/* Controls: add a seat, the reply layout, the chart toggle. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {masters.length < MAX_SEATS && (
              <button onClick={() => setPicker({ replace: null })} style={{
                padding: '7px 12px', borderRadius: 999, border: '1px dashed var(--border2)',
                background: 'none', color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer',
              }}>＋ {t('xtell.addmaster')}</button>
            )}
            <span style={{ flex: 1 }} />
            {(masters.length > 1 || replyModels.length > 1) && (
              <span style={{ display: 'inline-flex', border: '1px solid var(--border2)', borderRadius: 999, overflow: 'hidden', fontSize: 11.5 }}>
                {(['columns', 'tabs'] as const).map(l => (
                  <button key={l} type="button" onClick={() => chooseLayout(l)} style={{
                    border: 'none', padding: '5px 11px', cursor: 'pointer', fontWeight: layout === l ? 700 : 500,
                    background: layout === l ? 'var(--surface2)' : 'transparent', color: layout === l ? 'var(--white)' : 'var(--muted)',
                  }}>{t(`xtell.layout.${l}`)}</button>
                ))}
              </span>
            )}
            <button onClick={() => setShowChart(v => !v)} style={{ border: 'none', background: 'none', color: 'var(--muted2)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline dotted' }}>
              {showChart ? t(questionRequired ? 'xtell.yixue.hidehelp' : temple === 'yixue' ? 'xtell.yixue.hidechart' : 'xtell.hidechart') : t(questionRequired ? 'xtell.yixue.viewhelp' : temple === 'yixue' ? 'xtell.yixue.viewchart' : 'xtell.viewchart')}
            </button>
          </div>

          {/* Seats: one equal-width column per master, and the settings
              cards sit in the SAME columns under their chips (owner, Sep 24:
              same width, side by side, never stacked). Both rows share one
              scroll frame, so on a phone four seats drag sideways together
              instead of wrapping. Clicking a name opens the picker to
              REPLACE that seat; ⚙ opens every seat's settings; ✕ removes a
              seat while another remains. */}
          {(() => {
            const cols = `repeat(${masters.length}, minmax(${masters.length > 1 ? 210 : 0}px, 1fr))`
            return (
              <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
                <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8 }}>
                  {masters.map((m, i) => (
                    <span key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 999, minWidth: 0,
                      border: '1px solid ' + (optsOpen ? SLOT_COLORS[i] + '66' : 'var(--border2)'), background: 'var(--surface)', fontSize: 12.5,
                    }}>
                      <ProviderLogo provider={m.provider} size={14} />
                      <button type="button" title={t('xtell.changemaster')} aria-label={`${t('xtell.changemaster')}: ${m.display_name}`} onClick={() => setPicker({ replace: m.id })}
                        style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--white)', font: 'inherit', fontWeight: 700, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
                        {m.display_name}
                      </button>
                      <button type="button" title={t('xtell.opts.title')} aria-label={`${t('xtell.opts.title')}: ${m.display_name}`} aria-expanded={optsOpen} onClick={() => setOptsOpen(v => !v)}
                        style={{ border: 'none', background: 'none', color: optsOpen ? SLOT_COLORS[i] : 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: 16, lineHeight: 1 }}>⚙</button>
                      {masters.length > 1 && (
                        <button aria-label={`${t('xtell.site.remove')} ${m.display_name}`} onClick={() => setMasters(ms => ms.filter(x => x.id !== m.id))}
                          style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: 11 }}>✕</button>
                      )}
                    </span>
                  ))}
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
                                <OptPill color={color} active={o.thinking == null} onClick={() => setOpts(m, { thinking: null })}>{t('xcreate.auto')}</OptPill>
                                {levels.map(l => (
                                  <OptPill key={l} color={color} active={o.thinking === l} onClick={() => setOpts(m, { thinking: l })}>{thinkingLabel(l, t)}</OptPill>
                                ))}
                              </OptGroup>
                            )}
                            {searchable(m) && (
                              <OptGroup label={t('xcreate.websearch')} last={isLast('search')}>
                                <OptPill color={color} active={!o.search} onClick={() => setOpts(m, { search: false })}>{t('xcreate.off')}</OptPill>
                                <OptPill color={color} active={o.search} onClick={() => setOpts(m, { search: true })}>{t('xcreate.on')}</OptPill>
                              </OptGroup>
                            )}
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

          {/* What this result is and where a beginner starts, before the
              term-dense detail; example questions until the first is sent. */}
          {temple !== 'yixue' && chart && !savedProblem && !unverified && (
            <ResultGuide temple={temple} chart={chart} showExamples={turns.length === 0} onExample={q => setInput(q)} />
          )}

          {/* 月老廟's 合盤, above everything: it is free, it is computed, and it
              is what the two of them came to see. The reading interprets it. */}
          {match && !savedProblem && !unverified && <HeCard match={match} />}

          {/* The chart. Open by default, foldable for anyone who only wants
              the reading. */}
          {showChart && chart && !savedProblem && (!unverified || isQian(temple)) && (
            <div className={standalone ? "xtell-chart" : undefined} style={{ ...card, padding: '14px 16px' }}>
              {temple === 'bazi' ? <><BaziBoard chart={chart} hourUnknown={!!birth.hourUnknown} />{chenggu && <ChengguCard data={chenggu} disabled={busy} onAsk={question => {
                  setInput(question)
                  composerRef.current?.focus()
                  composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }} />}</>
                : temple === 'ziwei' ? <ZiweiBoard chart={chart} />
                : isQian(temple) ? <QianCard qian={chart} temple={temple} bazi={unverified ? null : bazi} year={unverified ? null : year} hourUnknown={bing.withBirth && !!birth.hourUnknown} />
                : temple === 'xingming' ? <NameBoard chart={chart} />
                : temple === 'cezi' ? <CeziBoard info={chart} ask={ask} />
                : temple === 'simianfo' ? <WishBoard chart={chart} wishes={wishes} year={year} hourUnknown={!!birth.hourUnknown} />
                : temple === 'navagraha' ? <NavagrahaBoard chart={chart} />
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

          {/* Conversation. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 120 }}>
            {turns.length === 0 && !savedProblem && !unverified && (
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
                    {m.cost > 0 && <span style={{ ...mono, fontSize: 9.5 }}>${m.cost.toFixed(3)}</span>}
                  </button>
                ))}
              </div>
            )}
            {rounds(turns).map((round, ri) => {
              // 分頁 shows one master's own thread: a question put to others
              // only is not part of it.
              const u = round.user as any
              if (layout === 'tabs' && replyModels.length > 1 && u?.to && activeTab && !u.to.includes(activeTab)) return null
              const only = round.user ? toOnly(round.user) : null
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
                              style={{ ...mono, color: 'var(--muted2)', cursor: Math.round(tn.cost * 100) === 0 ? 'help' : undefined }}>· ${tn.cost.toFixed(4)}</span>
                          )}
                          <span style={{ flex: 1 }} />
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
          {/* What this consultation was cast from, and the way back to the
              form, right where a paid question is written (audit: no visible
              way to correct the details). */}
          {temple !== 'yixue' && (() => {
            const summary = subjectSummary(t, temple, subject())
            return <div className="xtell-subject" style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
              {summary && <span><span style={{ ...mono, color: 'var(--muted2)', marginRight: 6 }}>{t('xtell.subject.label')}</span>{summary}</span>}
              <button type="button" onClick={editDetails} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--red)', fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>{t('xtell.edit')}</button>
            </div>
          })()}
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
              placeholder={questionRequired ? t('xtell.yixue.question.ph') : temple === 'yixue' ? t('xtell.question.ph') : `${t('xtell.q.example')}${t(`xtell.q.${temple}.1`)}`}
              maxLength={temple === 'yixue' ? 2000 : undefined}
              rows={4}
              style={{ flex: 1, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, resize: 'vertical' }}
            />
            <button aria-label={t('xtell.site.send')} onClick={() => void send(true)} disabled={busy || (questionRequired && !input.trim())} style={{
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
              {t('xtell.estimate').replace('{amount}', fmtUsd(total))}
              {known.length > 1 && <> · {known.map(p => `${p.m.display_name} ${fmtUsd(p.usd)}`).join(' · ')}</>}
            </div>
          })()}
          {questionRequired && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.yixue.question.privacy')}</p>}
          </div>}
        </div>
      )}

      {picker && (
        <ModelPickerDialog
          mode="text" recipeMode="text_to_text" feature="xtell" slotIds={masters.filter(m => m.id !== picker.replace).map(m => m.id)}
          onSelect={m => {
            setMasters(ms => {
              if (ms.some(x => x.id === m.id)) return ms
              if (picker.replace) return ms.map(x => (x.id === picker.replace ? m : x))
              return ms.length >= MAX_SEATS ? ms : [...ms, m]
            })
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

// ── 看懂這張盤 ──────────────────────────────────────────────────────────────
// Audit (product): 紫微 and 九曜 opened straight into dense terms. Each
// result now starts with what it is and where to start, plus one computed
// fact where it is safe to state (日主; 命宮 and its stars; 上升 and the
// Moon's 宿), and three questions that fit this temple. The examples fill
// the question box; nothing is sent.
const GAN_ELEMENT: Record<string, string> = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' }
function ResultGuide({ temple, chart, onExample, showExamples }: { temple: Temple; chart: any; onExample: (q: string) => void; showExamples: boolean }) {
  const t = useT()
  const fact = (() => {
    try {
      if (temple === 'bazi' && GAN_ELEMENT[chart?.dayMaster]) return t('xtell.sum.bazi.fact').replace('{dm}', chart.dayMaster).replace('{el}', t(`xtell.el.${GAN_ELEMENT[chart.dayMaster]}`))
      if (temple === 'ziwei') {
        const p = chart?.palaces?.find((x: any) => x.name === '命宮')
        if (p) return t('xtell.sum.ziwei.fact').replace('{gz}', p.ganZhi).replace('{stars}', p.majorStars.map((x: string) => x.replace(/\[.*?\]/g, '')).join('、') || '—')
      }
      if (temple === 'navagraha' && chart?.lagna) {
        const moon = chart.grahas?.find((g: any) => g.graha === 'Moon')
        return t('xtell.sum.navagraha.fact').replace('{lagna}', RASI[chart.lagna.rasi][1]).replace('{nak}', moon ? `${NAKSHATRA[moon.nakshatra][1]}宿` : '—')
      }
    } catch { /* an older saved chart shape simply has no fact line */ }
    return ''
  })()
  // Three per temple; 八字廟 has a fourth, the way into its 稱骨 card.
  const questions = [1, 2, 3, 4].map(i => t(`xtell.q.${temple}.${i}`)).filter(q => !q.startsWith('xtell.q.'))
  return (
    <section className="xtell-guide" aria-label={t('xtell.guide.title')} style={{ ...card, padding: '12px 16px', display: 'grid', gap: 6 }}>
      <div style={{ ...mono, color: 'var(--muted2)' }}>{t('xtell.guide.title')}</div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>{t(`xtell.sum.${temple}.what`)}{fact ? ` ${fact}` : ''}</p>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: 'var(--muted)' }}>{t(`xtell.sum.${temple}.look`)}</p>
      {showExamples && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
          <span style={{ fontSize: 12, color: 'var(--muted2)' }}>{t('xtell.guide.ask')}</span>
          {questions.map(q => (
            <button key={q} type="button" onClick={() => onExample(q)} aria-label={`${t('xtell.guide.fill')}: ${q}`} style={{
              padding: '5px 11px', borderRadius: 999, border: '1px solid var(--border2)', background: 'transparent',
              color: 'var(--white)', fontSize: 12, lineHeight: 1.5, cursor: 'pointer', textAlign: 'left',
            }}>{q}</button>
          ))}
        </div>
      )}
    </section>
  )
}

// ── 合盤 ────────────────────────────────────────────────────────────────────
// Every number here came out of lib/xtell.ts, and every row says which two
// 干支 it read and what relation it found — the same contract as the chart
// below it. Nothing on this card is the model's opinion.
function HeCard({ match }: { match: any }) {
  const t = useT()
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
            <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--muted2)', marginTop: -4 }}>{d.detail}</div>
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
                <span style={{ color: y.good ? 'var(--green)' : 'var(--red)', fontWeight: 600, minWidth: 56 }}>{y.kind}</span>
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
        {unknown ? `${String(chart.solar).slice(0, 10)} · ${t('xtell.hourunknown')}` : chart.solar} · {chart.lunar}
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
              <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 6 }}>{both ? `${both[0].naYin}／${both[1].naYin}` : p.naYin}</div>
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
  const rel = (kind: string, taiSui: string) => `${kind}${taiSui && taiSui !== '無' ? `（${taiSui}）` : ''}`
  const vsYear = Array.isArray(year.yearChoices)
    ? t('xtell.liunian.yearUndecided').replace('{list}', year.yearChoices.map((c: any) => t('xtell.liunian.ifYear').replace('{gz}', c.ganZhi).replace('{rel}', rel(c.yearBranch?.kind, c.taiSui))).join(t('xtell.list.sep')))
    : rel(year.yearBranch?.kind, year.taiSui)
  return (
    <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>
      <span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.liunian')}</span>
      {year.year} {year.ganZhi}　{t('xtell.liunian.vsDay')} <b>{year.shiShen}</b>　{t('xtell.liunian.vsDayBranch')} <b>{year.dayBranch?.kind}</b>　{t('xtell.liunian.vsYear')} <b>{vsYear}</b>
      {Array.isArray(year.daYunChoices)
        ? <>　{t('xtell.dayun')} <b>{year.daYunChoices.join('／')}</b> <span style={{ fontSize: 11 }}>（{t('xtell.dayun.approx')}）</span></>
        : year.daYun ? <>　{t('xtell.dayun')} <b>{year.daYun}</b>{year.daYunApprox ? <span style={{ fontSize: 11 }}>（{t('xtell.dayun.approx')}）</span> : null}</> : null}
    </div>
  )
}

function ZiweiBoard({ chart }: { chart: any }) {
  const t = useT()
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        {chart.solar} · {chart.lunar} {chart.time} · {chart.fiveElementsClass} · {t('xtell.ziwei.soul')} {chart.soul} · {t('xtell.ziwei.body')} {chart.body}
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
              <span style={{ fontFamily: 'var(--font-mono), monospace', margin: '0 8px' }}>{p.ganZhi}{p.range ? ` · ${p.range[0]}–${p.range[1]}歲` : ''}</span>
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
function BirthRow({ label, value, onChange, sel, allowUnknown = true, aria }: {
  label?: string
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
function RitualPanel({ ask, setAsk, stick, ritual, onDraw, onThrow, bing, setBing, birth, setBirth, sel }: {
  ask: string; setAsk: (s: string) => void
  stick: { n: number; throws: Jiao[] } | null
  ritual: 'idle' | 'drawn' | 'rejected' | 'confirmed'
  onDraw: () => void; onThrow: () => void
  bing: { name: string; city: string; withBirth: boolean }; setBing: (b: { name: string; city: string; withBirth: boolean }) => void
  birth: any; setBirth: (b: any) => void; sel: any
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
            {bing.withBirth && <BirthRow value={birth} onChange={setBirth} sel={sel} />}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', minHeight: 56 }}>
        {stick ? (
          <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 30, fontWeight: 800, letterSpacing: 2 }}>
            {t('xtell.qian.stick')} {stick.n} {t('xtell.qian.stickunit')}
          </div>
        ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('xtell.qian.rule')}<div style={{ fontSize: 11.5, color: 'var(--muted2)', marginTop: 4, lineHeight: 1.6 }}>{t('xtell.qian.random')}</div></div>}
        {stick && (
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
        {ritual === 'confirmed' && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>{t('xtell.qian.confirmed')}</span>}
      </div>
      {ritual === 'idle' && birthBad && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>{errorText(t, `birth_${birthBad}`, birthBad)}</div>}
      {ritual === 'rejected' && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{t('xtell.qian.rejected')}</div>}
      {stick && ritual !== 'rejected' && <div style={{ fontSize: 11.5, color: 'var(--muted2)' }}>{t('xtell.qian.rule')}</div>}
    </div>
  )
}

/** The stick, as the temple prints it: number, luck, story, the four lines,
 *  and every commentary the edition carries. All of it is text from disk. */
function QianCard({ qian, temple, bazi, year, hourUnknown = false }: { qian: any; temple: Temple; bazi?: any; year?: any; hourUnknown?: boolean }) {
  const t = useT()
  // 關帝's edition grades each stick (大吉 … 下下); 媽祖's carries a 五行/direction
  // line instead, which is a hint, not a grade, so it stays neutral.
  const graded = temple !== 'mazu'
  const luckColour = !graded ? 'var(--muted)' : /上|大/.test(qian.luck) ? 'var(--score-elite)' : /中/.test(qian.luck) ? 'var(--score-fair)' : 'var(--score-poor)'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 20, fontWeight: 800 }}>{t('xtell.history.stick').replace('{n}', String(qian.n))}　{qian.ganZhi}</div>
        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: graded ? 18 : 14, fontWeight: graded ? 800 : 600, color: luckColour }}>{qian.luck}</div>
        {qian.story && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{qian.story}</div>}
      </div>
      <div style={{ padding: '18px 16px', background: 'var(--surface2)', borderRadius: 10, textAlign: 'center' }}>
        {qian.poem.map((l: string, i: number) => (
          <div key={i} style={{ fontFamily: 'var(--font-display), serif', fontSize: 22, fontWeight: 700, letterSpacing: 3, lineHeight: 1.8 }}>{l}</div>
        ))}
      </div>
      <div style={{ ...mono, color: 'var(--muted2)', margin: '14px 0 8px' }}>{t(temple === 'mazu' ? 'xtell.qian.notes.mazu' : 'xtell.qian.notes')}</div>
      <div style={{ display: 'grid', gap: 10 }}>
        {Object.entries(qian.sections as Record<string, string>).map(([name, text]) => (
          <div key={name} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 10, fontSize: 13, lineHeight: 1.7 }}>
            <b style={{ color: 'var(--muted)' }}>{name}</b>
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
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t(temple === 'mazu' ? 'xtell.qian.source.mazu' : 'xtell.qian.source')}</div>
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
function NavagrahaBoard({ chart }: { chart: any }) {
  const t = useT()
  const dms = (d: number) => `${Math.floor(d)}°${String(Math.round((d % 1) * 60)).padStart(2, '0')}'`
  const rasi = (i: number) => RASI[i][1]
  const nak = (i: number, pada: number) => `${NAKSHATRA[i][0]} ${NAKSHATRA[i][1]}宿 ${pada}`
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
                <td style={{ padding: '6px 10px 6px 0', fontWeight: 700 }}>{GRAHA_ZH[g.graha as keyof typeof GRAHA_ZH]} <span style={{ color: 'var(--muted2)', fontWeight: 400 }}>{GRAHA_SA[g.graha as keyof typeof GRAHA_SA]}</span></td>
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
            }}>{GRAHA_ZH[p.lord as keyof typeof GRAHA_ZH]} {ymd(p.from).slice(0, 4)}–{ymd(p.to).slice(0, 4)}{now ? ` · ${t('xtell.dasha.now')}` : ''}</span>
          )
        })}
      </div>
      {chart.dasha.currentAntar && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>
          {t('xtell.dasha.now')}：{GRAHA_ZH[chart.dasha.current.lord as keyof typeof GRAHA_ZH]} / {GRAHA_ZH[chart.dasha.currentAntar.lord as keyof typeof GRAHA_ZH]}　{ymd(chart.dasha.currentAntar.from)} – {ymd(chart.dasha.currentAntar.to)}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t('xtell.nav.note')}</div>
    </div>
  )
}

// ── 占星塔 ─────────────────────────────────────────────────────────────────

function PlaceRow({ label, value, onChange, sel, aria }: { label?: string; value: string; onChange: (v: string) => void; sel: any; aria?: FieldAria }) {
  const t = useT()
  return (
    <div className="xtell-place-row" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, marginLeft: 62 }}>
      <span style={{ fontSize: 12, color: 'var(--muted2)' }} aria-hidden="true">{t('xtell.place')}</span>
      <select aria-label={`${label ?? ''} ${t('xtell.place')}`.trim()} aria-invalid={aria?.invalid || undefined} aria-describedby={aria?.invalid ? aria.describedBy : undefined} style={sel} value={value} onChange={e => onChange(e.target.value)}>
        {PLACES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
    </div>
  )
}

const sign = (i: number) => `${SIGNS[i][1]}座`
/** One sign, or both of a transition day's when the hour is unknown. Reads
 *  the engine's daySigns; `moonSigns` is the short-lived earlier shape of the
 *  same idea, still on a few saved charts. */
const signsOfC = (c: any, body: string): number[] => {
  const two = c?.daySigns?.[body] ?? (body === 'Moon' ? c?.moonSigns : undefined)
  if (Array.isArray(two) && two.length > 1) return two
  const p = c?.planets?.find((x: any) => x.body === body)
  return p ? [p.sign] : []
}
const signLabelC = (c: any, body: string) => signsOfC(c, body).map(sign).join(' / ')
const dms = (d: number) => `${Math.floor(d)}°${String(Math.floor((d % 1) * 60)).padStart(2, '0')}'`
const nameOf = (k: string) => (PLANET_ZH as any)[k] ?? (POINT_ZH as any)[k] ?? k
const glyphOf = (k: string) => (PLANET_GLYPH as any)[k] ?? ''

/** One aspect as a chip. The orb is on it because a 0.2° square and a 6.8°
 *  square are not the same statement, and the whole point of showing the
 *  chart is that the reading can be checked against it. */
function AspectChip({ a, prefix }: { a: any; prefix?: [string, string] }) {
  const tight = a.orb < 1
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 999,
      border: '1px solid ' + (tight ? 'var(--red)' : 'var(--border2)'), fontSize: 11.5,
      color: tight ? 'var(--red)' : 'var(--muted)', whiteSpace: 'nowrap',
    }}>
      <span>{prefix?.[0]}{nameOf(a.a)}</span>
      <span style={{ fontSize: 13 }}>{a.glyph}</span>
      <span>{prefix?.[1]}{nameOf(a.b)}</span>
      <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10, opacity: 0.75 }}>
        {a.orb.toFixed(1)}°{a.applying ? '→' : ''}
      </span>
    </span>
  )
}

function Bars({ title, data, keys }: { title: string; data: Record<string, number>; keys: readonly string[] }) {
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
            <div style={{ fontSize: 11.5, marginTop: 4 }}>{k}</div>
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
  const twoBodies: string[] = unknown ? c.planets.filter((p: any) => signsOfC(c, p.body).length > 1).map((p: any) => PLANET_ZH[p.body as keyof typeof PLANET_ZH]) : []
  const local = localStamp(String(c.utc), String(c.tz))
  // The answer to 「我是什麼星座」 comes first. The everyday 星座 is the Sun
  // sign; the Ascendant, which used to lead the board, was being read as the
  // answer (Codex QA, Sep 25).
  const big: Array<[string, string, string]> = [
    ['sun', signLabelC(c, 'Sun'), t('xtell.astro.sun.meaning')],
    ['moon', signLabelC(c, 'Moon'), t('xtell.astro.moon.meaning')],
    ['asc', unknown ? t('xtell.astro.needstime') : sign(Math.floor(c.angles.asc / 30)), t('xtell.astro.asc.meaning')],
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
                {PLANET_ZH[p.body as keyof typeof PLANET_ZH]}
              </td>
              <td style={{ padding: '6px 14px 6px 0' }}>{signLabelC(c, p.body)}</td>
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
          ? t('xtell.astro.sunsign.either').replace('{a}', sign(sunSigns[0])).replace('{b}', sign(sunSigns[1]))
          : t('xtell.astro.sunsign.is').replace('{sign}', sign(sunSigns[0]))}
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
                      <span style={{ fontFamily: 'var(--font-display), serif', fontSize: 19, fontWeight: 800 }}>{sign(Math.floor(v / 30))}</span>
                      <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--muted)' }}>{dms(v % 30)}</span>
                    </span>
                  ))}
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {t('xtell.astro.ruler')} {c.chartRuler ? PLANET_ZH[c.chartRuler as keyof typeof PLANET_ZH] : '—'} · {t(`xtell.astro.sect.${c.sect}`)}
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
                        {sign(Math.floor(x / 30))} {dms(x % 30)}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap', margin: '18px 0 4px' }}>
                <Bars title={t('xtell.astro.elements')} data={c.balance.elements} keys={ELEMENTS} />
                <Bars title={t('xtell.astro.modalities')} data={c.balance.modalities} keys={MODALITIES} />
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
              {glyphOf(p.body)} {PLANET_ZH[p.body as keyof typeof PLANET_ZH]} {sign(p.sign)} {dms(p.deg)}
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
          <span style={{ fontSize: 13 }}>{t('xtell.astro.moontoday')} <b>{sign(d.moonSign)}</b></span>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {d.retro.length
              ? `${t('xtell.astro.retro')}：${d.retro.map((p: string) => PLANET_ZH[p as keyof typeof PLANET_ZH]).join('、')}`
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
                    <b>{glyphOf(x.a)} {nameOf(x.a)}</b> <span style={{ color: 'var(--muted2)' }}>{sign(x.transitSign)} {dms(x.transitDeg)}{x.retro ? ' ℞' : ''}</span>
                  </td>
                  <td style={{ padding: '6px 12px 6px 0' }}>{x.glyph} {nameOf(x.b)}</td>
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
              <span style={{ fontFamily: 'var(--font-display), serif', fontSize: 20, fontWeight: 800 }}>{sign(Math.floor(ret.asc / 30))}</span>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--muted)' }}>{dms(ret.asc % 30)}</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* Saved charts from before the engine dropped the return Moon still carry it. */}
          {ret.planets.filter((p: any) => !(c.hourUnknown && p.body === 'Moon')).slice(0, 10).map((p: any) => (
            <span key={p.body} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border2)', fontSize: 11.5, color: 'var(--muted)' }}>
              {glyphOf(p.body)} {sign(p.sign)} {dms(p.deg)} {!c.hourUnknown && <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)' }}>H{p.house}</span>}
            </span>
          ))}
        </div>
        <div style={{ ...mono, color: 'var(--muted2)', margin: '18px 0 6px' }}>{t('xtell.astro.prog')}</div>
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          {t('xtell.astro.progsun')} <b>{sign(prog.sun.sign)} {c.hourUnknown ? `${Math.round(prog.sun.deg)}°` : `${prog.sun.deg.toFixed(1)}°`}</b>　·　
          {t('xtell.astro.progmoon')} <b>{sign(prog.moon.sign)}{c.hourUnknown ? '' : ` ${prog.moon.deg.toFixed(1)}°`}</b>
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
          <input value={surname} maxLength={2} onChange={e => onSurname(e.target.value.replace(/\s/g, '').slice(0, 2))} {...mark(surnameAria)} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700 }}>
          {t('xtell.given')}
          <input value={given} maxLength={2} onChange={e => onGiven(e.target.value.replace(/\s/g, '').slice(0, 2))} {...mark(givenAria)} />
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
            <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{c.radical}部</div>
          </div>
        ))}
      </div>
      <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 8 }}>{t('xtell.name.grids')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
        {ge.map(g => (
          <div key={g.key} style={{ border: '1px solid ' + (g.key === 'ren' ? 'var(--red)' : 'var(--border2)'), borderRadius: 10, padding: '10px 12px', background: g.key === 'ren' ? 'var(--surface2)' : 'transparent' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b style={{ fontSize: 12.5 }}>{g.label}</b>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 20, fontWeight: 800 }}>{g.n}</span>
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              <span style={{ color: 'var(--muted)' }}>{g.wuxing}　</span>
              <span style={{ fontWeight: 700, color: luckColour[g.shuli.luck] ?? 'var(--muted)' }}>{g.shuli.luck}</span>
              <span style={{ color: 'var(--muted)' }}>　{g.shuli.name}{g.n !== g.shuli.n ? `（${g.shuli.n}）` : ''}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13 }}>
        <span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.name.sancai')}</span>
        天{chart.sancai.tian} 人{chart.sancai.ren} 地{chart.sancai.di}　
        <span style={{ color: 'var(--muted)' }}>天→人 {chart.sancai.tianRen}，人→地 {chart.sancai.renDi}　{chart.sancai.label}</span>
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
  return (
    <div>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 72, fontWeight: 800, lineHeight: 1, padding: '10px 18px', background: 'var(--surface2)', borderRadius: 12 }}>{info.ch}</div>
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          <div><span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.cezi.radical')}</span>{info.radical}部（{info.radicalStrokes}畫）</div>
          <div><span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.name.chars')}</span>{info.strokes}</div>
          {ask && <div><span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.qian.ask')}</span>{ask}</div>}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t('xtell.cezi.source')}</div>
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
  const client = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
  useEffect(() => {
    let active = true
    void (async () => {
      const sb = client()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { if (active) setLoaded(true); return }
      const { data } = await sb.from('xtell_readings')
        .select('id, temple, subject, chart, extras, turns, title, cost_cents, created_at')
        .eq('user_id', user.id).eq('temple', temple).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(5)
      if (active) { setRows((data ?? []) as any); setLoaded(true) }
    })()
    return () => { active = false }
  }, [temple])
  const remove = async (id: string) => {
    setConfirming(null)
    if (await eraseReading(client(), id)) { setFailed(null); setRows(rs => rs.filter(r => r.id !== id)) }
    else setFailed(id)
  }
  if (!loaded || rows.length === 0) return null
  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 8 }}>{t('xtell.history.temple')}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map(r => {
          const asked = (r.turns ?? []).filter((x: any) => x.role === 'user').length
          // Named by what it was about (the birth, the stick, the hexagram),
          // with the first question as the title once one was asked.
          const what = describeVisit(t, temple, r.subject)
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 200 }}>
                <b>{r.title || what || t(notAskedKey(temple))}</b>
                {r.title && what && <span style={{ display: 'block', color: 'var(--muted2)', fontSize: 11.5 }}>{what}</span>}
                <span style={{ color: 'var(--muted2)', marginLeft: r.title && what ? 0 : 8 }}>
                  {new Date(r.created_at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}
                  {asked > 0 ? `　${asked} ${t('xtell.saved.turns')}` : `　${t(notAskedKey(temple))}`}
                  {r.cost_cents > 0 ? `　$${(r.cost_cents / 100).toFixed(2)}` : ''}
                </span>
              </span>
              {confirming === r.id ? (
                <span role="group" aria-label={t('xtell.saved.deleteConfirm')} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexBasis: '100%' }}>
                  <span style={{ fontSize: 12, color: 'var(--red)' }}>{t('xtell.saved.deleteConfirm')}</span>
                  <button type="button" onClick={() => void remove(r.id)} style={{ padding: '5px 12px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('xtell.saved.deleteYes')}</button>
                  <button type="button" onClick={() => setConfirming(null)} style={{ border: 'none', background: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xtell.saved.deleteNo')}</button>
                </span>
              ) : (<>
                <button type="button" onClick={() => onResume(r)} style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid var(--red)', background: 'none', color: 'var(--red)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('xtell.saved.continue')}</button>
                <button type="button" onClick={() => { setFailed(null); setConfirming(r.id) }} style={{ border: 'none', background: 'none', color: 'var(--muted2)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xtell.saved.delete')}</button>
              </>)}
              {failed === r.id && <span role="alert" style={{ flexBasis: '100%', fontSize: 12, color: 'var(--red)' }}>{t('xtell.saved.deleteFailed')}</span>}
            </div>
          )
        })}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.saved.removeNote')}</p>
    </div>
  )
}
