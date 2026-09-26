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

import { useEffect, useRef, useState } from 'react'
import { useSite } from '../../lib/useSite'
import XTellAuthGate from '../components/xtell/XTellAuthGate'
import TempleStreet, { TEMPLES } from '../components/xtell/TempleStreet'
import { TempleArtwork } from '../components/xtell/TempleArtwork'
import { XTellFooter } from '../components/xtell/XTellNav'
import { createBrowserClient } from '@supabase/ssr'
import { useT, useLang } from '../../lib/i18n'
import { useRequireAuth } from '../../lib/useRequireAuth'
import ModelPickerDialog, { type PickerModel } from '../components/ModelPickerDialog'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '../../lib/markdown'
import ProviderLogo from '../components/ProviderLogo'
import { drawQian, throwJiao, cryptoRand, CONFIRM_THROWS, QIAN_COUNTS, type Jiao } from '../../lib/xtell-ritual'
import { OptPill, OptGroup, SLOT_COLORS, thinkingLabel } from '../components/OptControls'

// Upfront estimate per master, shown under the composer (Codex QA, Sep 25:
// nothing said what a question would cost before Send). The system prompt
// measured 1.6k–2.8k chars (八字 / 紫微: persona + facts + classics), and CJK
// runs near one token per char, so 3,000 input tokens covers it, plus the
// thread and the question; 800 output tokens is a full reading with thinking
// on. Search terms mirror XCreate's estimator. A ceiling, not a quote: the
// receipt is the cost under each reply.
const EST_PROMPT_TOKENS = 3000, EST_OUT_TOKENS = 800, EST_SEARCHES = 8, EST_READ_TOKENS = 30_000
// 易學堂 can include both hexagrams and their 文言. Its longest measured
// fixed cast prompt exceeds 4,200 characters before the language line.
const EST_YIXUE_PROMPT_TOKENS = 5500
function rateOf(r: any, level: string | null): number {
  if (r == null) return 0
  if (typeof r === 'number') return r
  if (level && r.by_level && typeof r.by_level[level] === 'number') return r.by_level[level]
  return typeof r.default === 'number' ? r.default : 0
}
function estimateReadingUsd(m: PickerModel, o: { thinking: string | null; search: boolean }, chars: number, promptTokens = EST_PROMPT_TOKENS): number | null {
  const p = m.model_pricing ?? {}, tk = p.tokens ?? {}
  const tin = rateOf(tk.text_input, o.thinking), tout = rateOf(tk.text_output, o.thinking)
  if (!tin && !tout) return null
  const inTok = promptTokens + chars + (o.search ? EST_READ_TOKENS : 0)
  return (o.search ? EST_SEARCHES * (p.per_search ?? 0) : 0) + (inTok * tin + EST_OUT_TOKENS * tout) / 1_000_000
}
const fmtUsd = (v: number) => v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`
import { PLACES, DEFAULT_PLACE } from '../../lib/xtell-places'
import { GRAHA_ZH, GRAHA_SA, RASI, NAKSHATRA } from '../../lib/jyotish'
import { PLANET_ZH, PLANET_GLYPH, POINT_ZH, SIGNS, ELEMENTS, MODALITIES, localStamp } from '../../lib/astrology'
import { throwCoins, valueOf, type Coin, type LineValue } from '../../lib/yijing-core'
import { YixueRitual, YixuePicker, YixueBoard } from '../components/xtell/Yixue'

type Temple = 'bazi' | 'ziwei' | 'yuelao' | 'guandi' | 'mazu' | 'simianfo' | 'navagraha' | 'zhanxing' | 'xingming' | 'cezi' | 'yixue'
const isQian = (t: Temple) => t === 'guandi' || t === 'mazu'

// 易學堂 has three rooms: cast a hexagram, look one up, or just ask the
// teacher. Mirrors YIXUE_MODES in lib/yijing.ts (server-only file).
const YIXUE_MODES = ['cast', 'lookup', 'ask'] as const
type YixueMode = (typeof YIXUE_MODES)[number]
/** A row of xtell_readings, as the room reopens it. */
type SavedReading = { id: string; temple: string; subject: any; chart: any; extras: any; turns: any[] }

// 占星塔 is the one temple with rooms: four readings off one chart. The other
// six ask a single question, so their form is a birth row and their board is
// a chart; this one has to be told which reading before it can even ask for
// the right input (配對 needs a second person).
const ASTRO_MODES = ['natal', 'synastry', 'today', 'year'] as const
type AstroMode = (typeof ASTRO_MODES)[number]

// The visitor's own last birth row, so 今日 does not make them retype it
// every morning. It stays in THEIR browser: a birth date, an exact time and
// a place is the most identifying thing anyone types into this site, and
// XTell stores nothing server-side. Cleared with the browser, never synced,
// never seen by us.
const REMEMBER_KEY = 'xtell.zhanxing.birth'

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
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const shichenOf = (h: number) => ZHI[h === 23 ? 0 : Math.floor((h + 1) / 2) % 12] + '時'

function RequireTempleAuth() { useRequireAuth(); return null }

export default function XTellClient({ standalone: standaloneOverride }: { standalone?: boolean }) {
  const site = useSite()
  const standalone = standaloneOverride ?? site === 'xtell'
  const t = useT()
  const [temple, setTemple] = useState<Temple | null>(null)
  const [selectedTemple, setSelectedTemple] = useState<Temple>('bazi')
  // ?reading=<id> reopens a saved visit (supabase/105): the row is fetched
  // under the visitor's own session, the temple opens on it, and TempleRoom
  // starts from its subject, chart and turns instead of an empty form.
  const [saved, setSaved] = useState<SavedReading | null>(null)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('reading')
    if (!id) return
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    sb.from('xtell_readings').select('id, temple, subject, chart, extras, turns').eq('id', id).is('deleted_at', null).maybeSingle()
      .then(({ data }) => {
        if (!data || !TEMPLES.includes(data.temple)) return
        setSaved(data as SavedReading)
        setSelectedTemple(data.temple as Temple)
        if (standalone) window.location.hash = data.temple
        setTemple(data.temple as Temple)
      })
  }, [standalone])
  useEffect(() => {
    if (!standalone) return
    const sync = () => {
      const key = window.location.hash.slice(1) as Temple
      setTemple(TEMPLES.includes(key) ? key : null)
      if (TEMPLES.includes(key)) setSelectedTemple(key)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [standalone])
  // Resume from inside a temple (its history list): seed the room from the
  // saved row without a page load. Same path ?reading= takes.
  const resume = (row: SavedReading) => {
    setSaved(row)
    setSelectedTemple(row.temple as Temple)
    if (standalone) window.location.hash = row.temple
    setTemple(row.temple as Temple)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  const chooseTemple = (key: Temple | null) => {
    if (standalone) window.location.hash = key ?? ''
    setTemple(key)
    if (key) setSelectedTemple(key)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  if (standalone) return <div className="xtell-site">
    <main id="xtell-main" className={'xtell-container' + (!temple ? ' xtell-explorer-container' : '')} tabIndex={-1}>
      {!temple ? <TempleStreet selected={selectedTemple} onSelect={setSelectedTemple} onEnter={chooseTemple} /> : <>
        <XTellAuthGate />
        <TempleRoom key={temple + (saved?.id ?? '')} temple={temple} onBack={() => { setSaved(null); chooseTemple(null) }} standalone initial={saved?.temple === temple ? saved : null} onResume={resume} />
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

        {!temple ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {(['bazi', 'ziwei', 'yuelao', 'guandi', 'mazu', 'simianfo', 'navagraha', 'zhanxing', 'xingming', 'cezi', 'yixue'] as Temple[]).map(k => (
              <div key={k} role="link" tabIndex={0} onClick={() => setTemple(k)}
                onKeyDown={e => { if (e.key === 'Enter') setTemple(k) }}
                style={{ ...card, overflow: 'hidden', cursor: 'pointer', transition: 'border-color .2s, transform .2s' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.transform = 'none' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* 易學堂 has no ink-wash cover yet; its explorer portrait stands in. */}
                <img src={k === 'yixue' ? '/xtell/approved/yixue-portrait.avif' : `/xtell/${k}.jpg`} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', objectPosition: k === 'yixue' ? 'center 42%' : undefined, display: 'block' }} />
                <div style={{ padding: '14px 18px 16px' }}>
                  <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{t(`xtell.${k}.name`)}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{t(`xtell.${k}.desc`)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <TempleRoom key={temple + (saved?.id ?? '')} temple={temple} onBack={() => { setSaved(null); setTemple(null) }} initial={saved?.temple === temple ? saved : null} onResume={resume} />
        )}

        <div style={{ marginTop: 40, fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.disclaimer')}</div>
      </div>
    </div>
  )
}

function TempleRoom({ temple, onBack, standalone = false, initial = null, onResume }: { temple: Temple; onBack: () => void; standalone?: boolean; initial?: SavedReading | null; onResume?: (r: SavedReading) => void }) {
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
  const [birth, setBirth] = useState<typeof defaultBirth>({ ...defaultBirth, ...(init.birth ?? {}), ...(init.gender && !init.birth ? { gender: init.gender } : {}) })
  const [readingId, setReadingId] = useState<string | null>(initial?.id ?? null)
  // 月老廟 needs a second person. Defaults to the other gender purely as a
  // starting point — both rows are fully editable, a couple is whoever they are.
  const [birth2, setBirth2] = useState<typeof defaultBirth>({ ...defaultBirth, gender: 'female', ...(init.birth2 ?? {}) })
  const [entered, setEntered] = useState(!!initial)
  const [chart, setChart] = useState<any>(initial?.chart ?? null)
  const [match, setMatch] = useState<any>(initial?.extras?.match ?? null)   // 月老廟's computed 合盤
  const [year, setYear] = useState<any>(initial?.extras?.year ?? null)     // 四面佛's (and an optional 稟告's) computed 流年
  const [bazi, setBazi] = useState<any>(initial?.extras?.bazi ?? null)     // 稟告 birth → 八字, shown under the stick
  // 關帝/媽祖 稟告: optional name, city, and whether to attach `birth`.
  const [bing, setBing] = useState({ name: init.name ?? '', city: init.city ?? '', withBirth: !!(init.birth && isQian(temple)) })
  // 關帝廟: the matter asked, and the ritual. The poem is never in the client
  // until the third 聖筊 — the server sends it with the chart response.
  const [ask, setAsk] = useState(init.ask ?? '')
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
  const [astroMode, setAstroMode] = useState<AstroMode>(temple === 'zhanxing' && init.mode ? init.mode : 'natal')
  // 易學堂: the room, the cast so far (six line values and the coin faces
  // behind them) and the hexagram picked in 查卦. The cast lives in a ref
  // mirrored into state, like the 籤 ritual: two fast clicks inside one
  // render must not both read the same five lines.
  const [yixueMode, setYixueMode] = useState<YixueMode>(temple === 'yixue' && (YIXUE_MODES as readonly string[]).includes(init.mode) ? init.mode : 'cast')
  const castRef = useRef<{ values: LineValue[]; coins: Coin[][] }>({
    values: temple === 'yixue' && Array.isArray(init.lines) ? init.lines : [],
    coins: temple === 'yixue' && Array.isArray(init.coins) ? init.coins : [],
  })
  const [cast, setCast] = useState(castRef.current)
  const [castEntering, setCastEntering] = useState(false)
  const [castFailed, setCastFailed] = useState(false)
  const [lookupN, setLookupN] = useState<number | null>(temple === 'yixue' && Number.isInteger(init.n) ? init.n : null)
  const yixueEntryPending = useRef(false)
  const [yixueEntryBusy, setYixueEntryBusy] = useState(false)
  // The teacher must receive the same subject that produced the visible
  // board, even if an entry control was changed while its request loaded.
  const yixueSubject = useRef<Record<string, unknown> | null>(temple === 'yixue' && initial ? { temple, ...init } : null)
  const [place2, setPlace2] = useState(init.place2 ?? DEFAULT_PLACE)
  const [srYear, setSrYear] = useState(init.year ?? new Date().getFullYear())
  const [engine, setEngine] = useState<string | null>(null)
  // Shown by default. The computed chart is the whole reason this page is not
  // just a chat window, and it was hidden behind a link nobody clicked.
  const [showChart, setShowChart] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Up to two masters. The default seat is the house pick — the latest good
  // text model (GPT-5.6 Sol) — preselected so the temple works with zero
  // configuration; the picker is there for people who care.
  const [masters, setMasters] = useState<PickerModel[]>([])
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
  const levelsOf = (m: PickerModel): string[] => ((m.output_config?.text?.thinking_levels ?? []) as string[])
  const searchable = (m: PickerModel) => ((m.output_config?.text?.capabilities ?? []) as string[]).includes('web_search')
  const defaultThinking = (m: PickerModel): string | null => {
    if (m.provider !== 'alibaba') return null
    const want = m.model_name === 'qwen3.8-flash' ? 'thinking_true' : 'thinking_false'
    return levelsOf(m).includes(want) ? want : null
  }
  const defaultOpts = (m: PickerModel): SeatOpts => ({ thinking: defaultThinking(m), search: false })
  const optsOf = (m: PickerModel): SeatOpts => seatOpts[m.id] ?? defaultOpts(m)
  const setOpts = (m: PickerModel, patch: Partial<SeatOpts>) => setSeatOpts(o => ({ ...o, [m.id]: { ...optsOf(m), ...patch } }))

  // One shared conversation: the visitor speaks once, every seated master
  // answers. Each master keeps its own private transcript server-side.
  type Turn = { role: 'user'; content: string } | { role: 'assistant'; content: string; modelId: string; name: string; provider: string; cost?: number }
  const [turns, setTurns] = useState<Turn[]>(() => (initial?.turns ?? []).map((x: any) => x.role === 'user'
    ? { role: 'user', content: String(x.content ?? '') }
    : { role: 'assistant', content: String(x.content ?? ''), modelId: x.modelId ?? '', name: x.name ?? '', provider: x.provider ?? '', cost: typeof x.cost === 'number' ? x.cost : undefined }))
  const [input, setInput] = useState('')
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
        // A reopened reading re-seats the masters of its last round, in the
        // order they answered, so 繼續 with four teachers continues with the
        // same four (owner, Sep 24). A master since removed from the catalog
        // is simply not re-seated.
        if (initial?.turns?.length) {
          const lastUser = initial.turns.map((x: any) => x.role).lastIndexOf('user')
          const ids: string[] = []
          for (const x of initial.turns.slice(lastUser + 1)) if (x.role === 'assistant' && x.modelId && !ids.includes(x.modelId)) ids.push(x.modelId)
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
        ...(yixueMode === 'cast' ? { ask: ask.trim(), lines: castRef.current.values, coins: castRef.current.coins }
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
      const raw = localStorage.getItem(REMEMBER_KEY)
      if (!raw) return
      const v = JSON.parse(raw)
      if (v && Number.isInteger(v.y)) {
        setBirth(b => ({ ...b, y: v.y, m: v.m, d: v.d, h: v.h, mi: v.mi, gender: v.gender ?? b.gender }))
        if (typeof v.place === 'string') setPlace(v.place)
      }
    } catch { /* no memory is fine; the form still works */ }
  }, [temple])

  const enter = async (n?: number): Promise<boolean> => {
    if (temple === 'yixue') {
      if (yixueEntryPending.current) return false
      yixueEntryPending.current = true
      setYixueEntryBusy(true)
    }
    setErr(null)
    if (temple === 'zhanxing') {
      try { localStorage.setItem(REMEMBER_KEY, JSON.stringify({ ...birth, place })) } catch { /* ignore */ }
    }
    try {
      const requestSubject = subject(n)
      const res = await fetch('/api/xtell/chart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestSubject),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      if (temple === 'yixue') yixueSubject.current = requestSubject
      setChart(d.chart)
      setMatch(d.match ?? null)
      setYear(d.year ?? null)
      setBazi(d.bazi ?? null)
      setEngine(d.engine ?? null)
      setReadingId(typeof d.readingId === 'string' ? d.readingId : null)
      setEntered(true)
      // 月老廟: the scores land free and instantly, so the only thing left to
      // ask is what they mean. Write the question for them but do NOT send it
      // — sending spends credits, and that stays a click the visitor makes.
      if (temple === 'yuelao') setInput(prev => prev || t('xtell.he.ask'))
      return true
    } catch (e: any) { setErr(String(e?.message ?? e)); if (isQian(temple)) setRitualBoth('drawn'); return false }
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
    castRef.current = next; setCast(next); setErr(null)
    if (next.values.length === 6) void enterCast()
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
    stickRef.current = s; setStick(s); setRitualBoth('drawn'); setErr(null)
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

  const send = async (fromButton = false) => {
    // The placeholder promises the question may be left empty: the button
    // then asks for a general reading, in the visitor's language. Enter on an
    // empty box stays a no-op so a stray key cannot spend credits.
    const typed = input.trim()
    if ((!typed && !fromButton) || busy || masters.length === 0) return
    const q = typed || t('xtell.question.general')
    setInput(''); setBusy(true); setErr(null)
    setTurns(ts => [...ts, { role: 'user', content: q }])
    // One id per question: every master's request carries it, the server
    // stores the question once (xtell_append_turns dedupes on it).
    const qid = crypto.randomUUID()

    // All seated masters answer the same question concurrently; each gets its
    // own history (its replies only) so two masters never contaminate each
    // other's thread.
    await Promise.all(masters.map(async m => {
      const history = turnsRef.current
        .filter(tn => tn.role === 'user' || (tn as any).modelId === m.id)
        .map(tn => ({ role: tn.role, content: tn.content }))
      const idx = pushAssistant(m)
      try {
        const res = await fetch('/api/xtell/reading', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(temple === 'yixue' ? yixueSubject.current ?? subject() : subject()), question: q, modelId: m.id, history, readingId, qid,
            search: optsOf(m).search && searchable(m),
            thinking: optsOf(m).thinking,
            lang,
          }),
        })
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d?.error ?? `HTTP ${res.status}`)
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
            if (type === 'error') { setErr(j.message ?? 'error'); doneAssistant(idx, 0) }
          }
        }
      } catch (e: any) { setErr(String(e?.message ?? e)); doneAssistant(idx, 0) }
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

  const sel = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 13 }

  return (
    // The arena is 1200 wide because XBoard/XEval put tables in it. A birth
    // form and a reading are prose, so the room keeps its own 980 measure.
    <div className={standalone ? "xtell-room" : undefined} style={{ maxWidth: 980 }}>
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
              {YIXUE_MODES.map(m => {
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
              <span style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6, marginTop: 2 }}>
                {t(`xtell.yixue.mode.${yixueMode}.hint`)}
              </span>
            </div>
          )}
          {temple === 'yixue' ? (
            yixueMode === 'cast'
              ? <YixueRitual ask={ask} setAsk={setAsk} values={cast.values} coins={cast.coins} onThrow={throwOnce}
                  onRetry={() => void enterCast()} entering={castEntering} failed={castFailed} sel={sel} />
              : yixueMode === 'lookup' ? <YixuePicker onPick={pickHexagram} picked={lookupN} disabled={yixueEntryBusy} />
              : null
          ) : isQian(temple) ? (
            <RitualPanel ask={ask} setAsk={setAsk} stick={stick} ritual={ritual} onDraw={draw} onThrow={throwBlocks}
              bing={bing} setBing={setBing} birth={birth} setBirth={setBirth} sel={sel} />
          ) : temple === 'xingming' ? (
            <NameForm surname={surname} given={given} gender={birth.gender}
              onSurname={setSurname} onGiven={setGiven} onGender={g => setBirth(b => ({ ...b, gender: g }))} sel={sel} />
          ) : temple === 'cezi' ? (
            <CeziForm ch={ch} setCh={setCh} ask={ask} setAsk={setAsk} sel={sel} />
          ) : temple === 'yuelao' || (temple === 'zhanxing' && astroMode === 'synastry') ? (
            <>
              <BirthRow label={t('xtell.person1')} value={birth} onChange={setBirth} sel={sel} />
              {temple === 'zhanxing' && <PlaceRow value={place} onChange={setPlace} sel={sel} />}
              <div style={{ height: 12 }} />
              <BirthRow label={t('xtell.person2')} value={birth2} onChange={setBirth2} sel={sel} />
              {temple === 'zhanxing' && <PlaceRow value={place2} onChange={setPlace2} sel={sel} />}
            </>
          ) : (
            <BirthRow value={birth} onChange={setBirth} sel={sel} allowUnknown={temple !== 'ziwei' && temple !== 'navagraha'} />
          )}
          {temple === 'simianfo' && <WishForm wishes={wishes} setWishes={setWishes} />}
          {temple === 'navagraha' && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t('xtell.place')}</span>
              <select style={sel} value={place} onChange={e => setPlace(e.target.value)}>
                {PLACES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <span style={{ fontSize: 11, color: 'var(--muted2)', flex: 1, minWidth: 240 }}>{t('xtell.place.note')}</span>
            </div>
          )}
          {temple === 'zhanxing' && astroMode !== 'synastry' && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t('xtell.place')}</span>
              <select style={sel} value={place} onChange={e => setPlace(e.target.value)}>
                {PLACES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              {astroMode === 'year' && (
                <>
                  <span style={{ fontSize: 12.5, fontWeight: 700, marginLeft: 8 }}>{t('xtell.astro.year.pick')}</span>
                  <select style={sel} value={srYear} onChange={e => setSrYear(+e.target.value)}>
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
              <button onClick={() => void enter()} disabled={temple === 'yixue' && yixueEntryBusy} style={{
                padding: '10px 26px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff',
                fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
              }}>{t(temple === 'yixue' ? 'xtell.yixue.enter' : 'xtell.enter')}</button>
            </div>
          )}
          {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 12.5 }}>⚠ {err}</div>}
          {/* This temple's saved visits (owner, Sep 24: history in each
              temple, not only on the account page). Continue reopens the
              room in place with chart and conversation. */}
          {onResume && <TempleHistory temple={temple} onResume={onResume} />}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
              {showChart ? t(temple === 'yixue' ? 'xtell.yixue.hidechart' : 'xtell.hidechart') : t(temple === 'yixue' ? 'xtell.yixue.viewchart' : 'xtell.viewchart')}
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
                      <button type="button" title={t('xtell.changemaster')} onClick={() => setPicker({ replace: m.id })}
                        style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--white)', font: 'inherit', fontWeight: 700, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
                        {m.display_name}
                      </button>
                      <button type="button" title={t('xtell.opts.title')} aria-expanded={optsOpen} onClick={() => setOptsOpen(v => !v)}
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

          {/* 月老廟's 合盤, above everything: it is free, it is computed, and it
              is what the two of them came to see. The reading interprets it. */}
          {match && <HeCard match={match} />}

          {/* The chart. Open by default, foldable for anyone who only wants
              the reading. */}
          {showChart && chart && (
            <div className={standalone ? "xtell-chart" : undefined} style={{ ...card, padding: '14px 16px' }}>
              {temple === 'bazi' ? <BaziBoard chart={chart} />
                : temple === 'ziwei' ? <ZiweiBoard chart={chart} />
                : isQian(temple) ? <QianCard qian={chart} temple={temple} bazi={bazi} year={year} />
                : temple === 'xingming' ? <NameBoard chart={chart} />
                : temple === 'cezi' ? <CeziBoard info={chart} ask={ask} />
                : temple === 'simianfo' ? <WishBoard chart={chart} wishes={wishes} year={year} />
                : temple === 'navagraha' ? <NavagrahaBoard chart={chart} />
                : temple === 'zhanxing' ? <ZhanxingBoard chart={chart} />
                : temple === 'yixue' ? <YixueBoard chart={chart} onExample={q => setInput(q)} />
                : (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div><div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.person1')}</div><BaziBoard chart={chart.a} /></div>
                    <div><div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.person2')}</div><BaziBoard chart={chart.b} /></div>
                  </div>
                )}
              {engine && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ ...mono, color: 'var(--muted2)', cursor: 'pointer' }}>{t('xtell.engine')}</summary>
                  <div style={{ ...mono, color: 'var(--muted2)', marginTop: 6 }}>{engine}</div>
                </details>
              )}
            </div>
          )}

          {/* Conversation. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 120 }}>
            {turns.length === 0 && (
              <div style={{ padding: '16px 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.7 }}>
                {t(temple === 'yixue' ? `xtell.yixue.intro.${chart?.mode ?? 'cast'}`
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
            {rounds(turns).map((round, ri) => (
              <div key={ri} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {round.user && (
                  <div style={{ alignSelf: 'flex-end', maxWidth: '82%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 12, padding: '10px 14px', fontSize: 13.5, whiteSpace: 'pre-wrap' }}>
                    {round.user.content}
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
            ))}
            <div ref={endRef} />
          </div>

          {err && <div style={{ color: 'var(--red)', fontSize: 12.5 }}>⚠ {err}</div>}

          {/* Composer — same shape as XDirect's. On the standalone site the
              block is sticky at the bottom, so the estimate line lives INSIDE
              it; placed after it, the line sat below the fold. */}
          <div className={standalone ? "xtell-composer" : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="xtell-composer-row" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
              aria-label={t('xtell.question.ph')} placeholder={t('xtell.question.ph')}
              rows={4}
              style={{ flex: 1, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, resize: 'vertical' }}
            />
            <button aria-label={t('xtell.site.send')} onClick={() => void send(true)} disabled={busy} style={{
              padding: '12px 20px', borderRadius: 10, border: 'none', background: 'var(--red)', color: 'var(--white)',
              fontWeight: 700, fontSize: 14, cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}>{busy ? '…' : '→'}</button>
          </div>
          {/* What this question will roughly cost, per master, before Send. */}
          {(() => {
            const chars = turns.reduce((n, tn) => n + tn.content.length, 0) + input.length
            const known = masters
              .map(m => ({ m, usd: estimateReadingUsd(m, { thinking: optsOf(m).thinking, search: optsOf(m).search && searchable(m) }, chars, temple === 'yixue' ? EST_YIXUE_PROMPT_TOKENS : EST_PROMPT_TOKENS) }))
              .filter((p): p is { m: PickerModel; usd: number } => p.usd != null)
            if (known.length === 0) return null
            const total = known.reduce((s, p) => s + p.usd, 0)
            return <div style={{ ...mono, fontSize: 11, color: 'var(--muted2)', lineHeight: 1.6 }}>
              {t('xtell.estimate').replace('{amount}', fmtUsd(total))}
              {known.length > 1 && <> · {known.map(p => `${p.m.display_name} ${fmtUsd(p.usd)}`).join(' · ')}</>}
            </div>
          })()}
          </div>
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
          {match.overall}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t(`xtell.he.band.${match.band}`)}</div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {match.dimensions.map((d: any) => (
          <div key={d.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, auto) 1fr minmax(72px, auto)', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.label}</div>
            <div style={{ height: 6, borderRadius: 999, background: 'var(--surface2)', overflow: 'hidden' }}>
              <div style={{ width: `${d.score}%`, height: '100%', background: rowColour(d.score), opacity: 0.8 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'flex-end' }}>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12.5, fontWeight: 700, color: rowColour(d.score) }}>{d.score}</span>
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
                <span style={{ color: 'var(--muted)' }}>{y.note}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t('xtell.he.note')}</div>
    </div>
  )
}

function BaziBoard({ chart }: { chart: any }) {
  const t = useT()
  const cols = [
    { key: 'year', label: t('xtell.p.year') }, { key: 'month', label: t('xtell.p.month') },
    { key: 'day', label: t('xtell.p.day') }, { key: 'time', label: t('xtell.p.time') },
  ]
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{chart.solar} · {chart.lunar}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(80px, 1fr))', gap: 8, maxWidth: 560 }}>
        {cols.map(c => {
          const p = chart.pillars[c.key]
          return (
            <div key={c.key} style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 8px', textAlign: 'center', background: c.key === 'day' ? 'var(--surface2)' : 'transparent' }}>
              <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginBottom: 6 }}>{c.label} · {p.shiShen}</div>
              <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 26, fontWeight: 800, letterSpacing: 4 }}>{p.ganZhi}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 6 }}>{p.naYin}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted2)' }}>藏 {p.hideGan.join(' ')}</div>
            </div>
          )
        })}
      </div>
      {chart.daYun?.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
          大運：{chart.daYun.map((d: any) => `${d.startAge}歲 ${d.ganZhi}`).join('　')}
        </div>
      )}
    </div>
  )
}

function ZiweiBoard({ chart }: { chart: any }) {
  const t = useT()
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        {chart.solar} · {chart.lunar} {chart.time} · {chart.fiveElementsClass} · 命主 {chart.soul} · 身主 {chart.body}
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


function BirthRow({ label, value, onChange, sel, allowUnknown = true }: {
  label?: string
  value: { y: number; m: number; d: number; h: number; mi: number; gender: 'male' | 'female'; hourUnknown?: boolean }
  onChange: (v: any) => void
  sel: any
  /** 紫微 cannot place 命宮 without an hour, so the checkbox hides there. */
  allowUnknown?: boolean
}) {
  const t = useT()
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {label && <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 52 }}>{label}</span>}
      <label className="xtell-birth-field"><select aria-label={`${label ?? ""} ${t("xtell.site.birth.year")}`} style={sel} value={value.y} onChange={e => onChange({ ...value, y: +e.target.value })}>
        {Array.from({ length: 106 }, (_, i) => 2010 - i).map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.year')}</span></label>
      <label className="xtell-birth-field"><select aria-label={`${label ?? ""} ${t("xtell.site.birth.month")}`} style={sel} value={value.m} onChange={e => onChange({ ...value, m: +e.target.value })}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.month')}</span></label>
      <label className="xtell-birth-field"><select aria-label={`${label ?? ""} ${t("xtell.site.birth.day")}`} style={sel} value={value.d} onChange={e => onChange({ ...value, d: +e.target.value })}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.day')}</span></label>
      <span className="xtell-birth-time"><select aria-label={`${label ?? ""} ${t("xtell.site.birth.hour")}`} style={{ ...sel, opacity: value.hourUnknown ? 0.4 : 1 }} disabled={!!value.hourUnknown} value={value.h} onChange={e => onChange({ ...value, h: +e.target.value })}>
        {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
      </select>
      :
      <select aria-label={`${label ?? ""} ${t("xtell.site.birth.minute")}`} style={{ ...sel, opacity: value.hourUnknown ? 0.4 : 1 }} disabled={!!value.hourUnknown} value={value.mi} onChange={e => onChange({ ...value, mi: +e.target.value })}>
        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(mi => <option key={mi} value={mi}>{String(mi).padStart(2, '0')}</option>)}
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
  const pill = (bg: string) => ({ padding: '10px 26px', borderRadius: 999, border: 'none', background: bg, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' })
  const jiaoColour: Record<Jiao, string> = { 聖筊: 'var(--green)', 笑筊: 'var(--muted)', 陰筊: 'var(--red)' }
  const jiaoKey: Record<Jiao, string> = { 聖筊: 'sheng', 笑筊: 'xiao', 陰筊: 'yin' }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.qian.ask')}</div>
        <input value={ask} onChange={e => setAsk(e.target.value.slice(0, 300))} placeholder={t('xtell.qian.ask.ph')}
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
              <input value={bing.name} maxLength={20} disabled={locked} onChange={e => setBing({ ...bing, name: e.target.value })} placeholder={t('xtell.qian.bing.name')} style={{ ...sel, flex: 1, minWidth: 160 }} />
              <input value={bing.city} maxLength={20} disabled={locked} onChange={e => setBing({ ...bing, city: e.target.value })} placeholder={t('xtell.qian.bing.city')} style={{ ...sel, flex: 1, minWidth: 160 }} />
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
        ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('xtell.qian.rule')}</div>}
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
        {ritual === 'idle' && <button onClick={onDraw} style={pill('var(--red)')}>{t('xtell.qian.draw')}</button>}
        {ritual === 'drawn' && <button onClick={onThrow} style={pill('var(--white)')}>{t('xtell.qian.throw')} {stick?.throws.length ?? 0}/{CONFIRM_THROWS}</button>}
        {ritual === 'rejected' && <button onClick={onDraw} style={pill('var(--red)')}>{t('xtell.qian.redraw')}</button>}
        {ritual === 'confirmed' && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>{t('xtell.qian.confirmed')}</span>}
      </div>
      {ritual === 'rejected' && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{t('xtell.qian.rejected')}</div>}
      {stick && ritual !== 'rejected' && <div style={{ fontSize: 11.5, color: 'var(--muted2)' }}>{t('xtell.qian.rule')}</div>}
    </div>
  )
}

/** The stick, as the temple prints it: number, luck, story, the four lines,
 *  and every commentary the edition carries. All of it is text from disk. */
function QianCard({ qian, temple, bazi, year }: { qian: any; temple: Temple; bazi?: any; year?: any }) {
  const t = useT()
  // 關帝's edition grades each stick (大吉 … 下下); 媽祖's carries a 五行/direction
  // line instead, which is a hint, not a grade, so it stays neutral.
  const graded = temple !== 'mazu'
  const luckColour = !graded ? 'var(--muted)' : /上|大/.test(qian.luck) ? 'var(--score-elite)' : /中/.test(qian.luck) ? 'var(--score-fair)' : 'var(--score-poor)'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 20, fontWeight: 800 }}>第{qian.n}籤　{qian.ganZhi}</div>
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
          <BaziBoard chart={bazi} />
          {year && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7, marginTop: 8 }}>
              <span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.liunian')}</span>
              {year.year} {year.ganZhi}　天干對日主 <b>{year.shiShen}</b>　地支對日支 <b>{year.dayBranch?.kind}</b>　對年支 <b>{year.yearBranch?.kind}</b>{year.taiSui !== '無' ? `（${year.taiSui}）` : ''}
            </div>
          )}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t(temple === 'mazu' ? 'xtell.qian.source.mazu' : 'xtell.qian.source')}</div>
    </div>
  )
}

// ── 四面佛 ─────────────────────────────────────────────────────────────────

function WishForm({ wishes, setWishes }: { wishes: Wishes; setWishes: (w: Wishes) => void }) {
  const t = useT()
  const area = { width: '100%', background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '9px 12px', color: 'var(--white)', fontSize: 13.5, resize: 'vertical' as const }
  return (
    <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{t('xtell.face.note')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {FACE_KEYS.map(k => (
          <div key={k}>
            <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 5 }}>{t(`xtell.face.${k}`)}</div>
            <textarea rows={2} value={wishes[k] ?? ''} onChange={e => setWishes({ ...wishes, [k]: e.target.value.slice(0, 400) })}
              placeholder={t('xtell.wish.ph')} style={area} />
          </div>
        ))}
      </div>
      <div>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 5 }}>{t('xtell.pledge')}</div>
        <textarea rows={2} value={wishes.pledge ?? ''} onChange={e => setWishes({ ...wishes, pledge: e.target.value.slice(0, 400) })}
          placeholder={t('xtell.pledge.ph')} style={area} />
      </div>
    </div>
  )
}

/** The 八字 board, this year's 流年 against it, and the four wishes as
 *  written — the same facts the keeper was handed. */
function WishBoard({ chart, wishes, year }: { chart: any; wishes: Wishes; year: any }) {
  const t = useT()
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <BaziBoard chart={chart} />
      {year && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>
          <span style={{ ...mono, color: 'var(--muted2)', marginRight: 8 }}>{t('xtell.liunian')}</span>
          {year.year} {year.ganZhi}　天干對日主 <b>{year.shiShen}</b>　地支對日支 <b>{year.dayBranch?.kind}</b>　對年支 <b>{year.yearBranch?.kind}</b>{year.taiSui !== '無' ? `（${year.taiSui}）` : ''}
          {year.daYun ? <>　大運 <b>{year.daYun}</b></> : null}
        </div>
      )}
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
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
          <thead>
            <tr style={{ ...mono, color: 'var(--muted2)', textAlign: 'left' }}>
              {['曜', '星座', '度', '宮', 'Nakshatra · pada', 'D9'].map(h => <th key={h} style={{ padding: '4px 10px 6px 0', fontWeight: 500 }}>{h}</th>)}
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

function PlaceRow({ value, onChange, sel }: { value: string; onChange: (v: string) => void; sel: any }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, marginLeft: 62 }}>
      <span style={{ fontSize: 12, color: 'var(--muted2)' }}>{t('xtell.place')}</span>
      <select style={sel} value={value} onChange={e => onChange(e.target.value)}>
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
  const planetTable = (
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
  )
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

function NameForm({ surname, given, gender, onSurname, onGiven, onGender, sel }: {
  surname: string; given: string; gender: 'male' | 'female'
  onSurname: (s: string) => void; onGiven: (s: string) => void; onGender: (g: 'male' | 'female') => void; sel: any
}) {
  const t = useT()
  const box = { ...sel, width: 96, fontSize: 18, fontFamily: 'var(--font-display), serif', letterSpacing: 4, textAlign: 'center' as const }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700 }}>
          {t('xtell.surname')}
          <input value={surname} maxLength={2} onChange={e => onSurname(e.target.value.replace(/\s/g, '').slice(0, 2))} style={box} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700 }}>
          {t('xtell.given')}
          <input value={given} maxLength={2} onChange={e => onGiven(e.target.value.replace(/\s/g, '').slice(0, 2))} style={box} />
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

function CeziForm({ ch, setCh, ask, setAsk, sel }: { ch: string; setCh: (s: string) => void; ask: string; setAsk: (s: string) => void; sel: any }) {
  const t = useT()
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700 }}>
          {t('xtell.cezi.char')}
          <input value={ch} maxLength={1} onChange={e => setCh(e.target.value.replace(/\s/g, '').slice(0, 1))} placeholder={t('xtell.cezi.char.ph')}
            style={{ ...sel, width: 72, fontSize: 28, fontFamily: 'var(--font-display), serif', textAlign: 'center' }} />
        </label>
        <input value={ask} onChange={e => setAsk(e.target.value.slice(0, 300))} placeholder={t('xtell.qian.ask.ph')}
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
    const { error } = await client().from('xtell_readings').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (!error) setRows(rs => rs.filter(r => r.id !== id))
  }
  if (!loaded || rows.length === 0) return null
  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 8 }}>{t('xtell.history.temple')}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map(r => {
          const asked = (r.turns ?? []).filter((x: any) => x.role === 'user').length
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 200 }}>
                <b>{r.title || t(temple === 'yixue' ? 'xtell.saved.chartonly.yixue' : 'xtell.saved.chartonly')}</b>
                <span style={{ color: 'var(--muted2)', marginLeft: 8 }}>
                  {new Date(r.created_at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}
                  {asked > 0 ? `　${asked} ${t('xtell.saved.turns')}` : ''}
                  {r.cost_cents > 0 ? `　$${(r.cost_cents / 100).toFixed(2)}` : ''}
                </span>
              </span>
              <button type="button" onClick={() => onResume(r)} style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid var(--red)', background: 'none', color: 'var(--red)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('xtell.saved.continue')}</button>
              <button type="button" onClick={() => void remove(r.id)} style={{ border: 'none', background: 'none', color: 'var(--muted2)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline dotted' }}>{t('xtell.saved.delete')}</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
