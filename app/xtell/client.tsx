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
import { createBrowserClient } from '@supabase/ssr'
import { useT } from '../../lib/i18n'
import { useRequireAuth } from '../../lib/useRequireAuth'
import ModelPickerDialog, { type PickerModel } from '../components/ModelPickerDialog'
import ReactMarkdown from 'react-markdown'
import ProviderLogo from '../components/ProviderLogo'
import { drawQian, throwJiao, cryptoRand, CONFIRM_THROWS, type Jiao } from '../../lib/xtell-ritual'
import { PLACES, DEFAULT_PLACE } from '../../lib/xtell-places'
import { GRAHA_ZH, GRAHA_SA, RASI, NAKSHATRA } from '../../lib/jyotish'

type Temple = 'bazi' | 'ziwei' | 'yuelao' | 'guandi' | 'simianfo' | 'navagraha'

// 四面佛's faces, clockwise. Mirrors FACES in lib/xtell.ts (server-only file).
const FACE_KEYS = ['peace', 'career', 'marriage', 'wealth'] as const
type Wishes = Partial<Record<(typeof FACE_KEYS)[number], string>> & { pledge?: string }

// The house default master: the latest good text model. One name to update
// when the catalog moves on.
const DEFAULT_MASTER = 'gpt-5.6-sol'

const mono = { fontFamily: 'var(--font-mono), monospace', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase' as const }
const card = { border: '1px solid var(--border2)', borderRadius: 12, background: 'var(--surface)' }

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const shichenOf = (h: number) => ZHI[h === 23 ? 0 : Math.floor((h + 1) / 2) % 12] + '時'

export default function XTellClient() {
  useRequireAuth()
  const t = useT()
  const [temple, setTemple] = useState<Temple | null>(null)

  return (
    <div className="xduel-page">
      <div className="arena">
        {/* House in-page header (XBoard/XEval pattern). The red "//" is drawn
            by .prompt-label.eyebrow in CSS, never typed into the string, and
            .page-headline sets the title size. This header was hand-rolled. */}
        <div className="prompt-label eyebrow">{t('xtell.eyebrow')}</div>
        <h1 className="page-headline" style={{ marginBottom: 10 }}>{t('xtell.title')}</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.65, maxWidth: 700, margin: '0 0 34px' }}>{t('xtell.sub')}</p>

        {!temple ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {(['bazi', 'ziwei', 'yuelao', 'guandi', 'simianfo', 'navagraha'] as Temple[]).map(k => (
              <div key={k} role="link" tabIndex={0} onClick={() => setTemple(k)}
                onKeyDown={e => { if (e.key === 'Enter') setTemple(k) }}
                style={{ ...card, overflow: 'hidden', cursor: 'pointer', transition: 'border-color .2s, transform .2s' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.transform = 'none' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/xtell/${k}.jpg`} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
                <div style={{ padding: '14px 18px 16px' }}>
                  <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{t(`xtell.${k}.name`)}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{t(`xtell.${k}.desc`)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <TempleRoom temple={temple} onBack={() => setTemple(null)} />
        )}

        <div style={{ marginTop: 40, fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.disclaimer')}</div>
      </div>
    </div>
  )
}

function TempleRoom({ temple, onBack }: { temple: Temple; onBack: () => void }) {
  const t = useT()
  const [birth, setBirth] = useState({ y: 1990, m: 1, d: 1, h: 12, mi: 0, gender: 'male' as 'male' | 'female', hourUnknown: false })
  // 月老廟 needs a second person. Defaults to the other gender purely as a
  // starting point — both rows are fully editable, a couple is whoever they are.
  const [birth2, setBirth2] = useState({ y: 1990, m: 1, d: 1, h: 12, mi: 0, gender: 'female' as 'male' | 'female', hourUnknown: false })
  const [entered, setEntered] = useState(false)
  const [chart, setChart] = useState<any>(null)
  const [match, setMatch] = useState<any>(null)   // 月老廟's computed 合盤
  const [year, setYear] = useState<any>(null)     // 四面佛's computed 流年
  // 關帝廟: the matter asked, and the ritual. The poem is never in the client
  // until the third 聖筊 — the server sends it with the chart response.
  const [ask, setAsk] = useState('')
  const [stick, setStick] = useState<{ n: number; throws: Jiao[] } | null>(null)
  const [ritual, setRitual] = useState<'idle' | 'drawn' | 'rejected' | 'confirmed'>('idle')
  // 四面佛: one wish per face, plus the pledge.
  const [wishes, setWishes] = useState<Wishes>({})
  // 九曜廟: the birth place (a curated city key; coordinates + zone resolve server-side).
  const [place, setPlace] = useState(DEFAULT_PLACE)
  const [engine, setEngine] = useState<string | null>(null)
  // Shown by default. The computed chart is the whole reason this page is not
  // just a chat window, and it was hidden behind a link nobody clicked.
  const [showChart, setShowChart] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Up to two masters. The default seat is the house pick — the latest good
  // text model (GPT-5.6 Sol) — preselected so the temple works with zero
  // configuration; the picker is there for people who care.
  const [masters, setMasters] = useState<PickerModel[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState(false)

  // One shared conversation: the visitor speaks once, every seated master
  // answers. Each master keeps its own private transcript server-side.
  type Turn = { role: 'user'; content: string } | { role: 'assistant'; content: string; modelId: string; name: string; provider: string; cost?: number }
  const [turns, setTurns] = useState<Turn[]>([])
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
        const pick = rows.find(r => r.model_name === DEFAULT_MASTER) ?? rows[0]
        if (pick) setMasters(m => (m.length ? m : [pick as PickerModel]))
      })
  }, [])

  const canSearch = masters.some(m => ((m.output_config?.text?.capabilities ?? []) as string[]).includes('web_search'))

  /** What identifies this consultation, per temple: birth(s), a stick
   *  number, or birth + wishes. Sent to both the chart and reading routes. */
  const subject = (n?: number) =>
    temple === 'guandi' ? { temple, n: n ?? stick?.n, ask }
    : temple === 'simianfo' ? { temple, birth, wishes }
    : temple === 'navagraha' ? { temple, birth, place }
    : { temple, birth, ...(temple === 'yuelao' ? { birth2 } : {}) }

  const enter = async (n?: number) => {
    setErr(null)
    try {
      const res = await fetch('/api/xtell/chart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subject(n)),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      setChart(d.chart)
      setMatch(d.match ?? null)
      setYear(d.year ?? null)
      setEngine(d.engine ?? null)
      setEntered(true)
      // 月老廟: the scores land free and instantly, so the only thing left to
      // ask is what they mean. Write the question for them but do NOT send it
      // — sending spends credits, and that stays a click the visitor makes.
      if (temple === 'yuelao') setInput(prev => prev || t('xtell.he.ask'))
    } catch (e: any) { setErr(String(e?.message ?? e)); if (temple === 'guandi') setRitualBoth('drawn') }
  }

  // The ritual. Draw a stick, throw the blocks; three 聖筊 confirm and open
  // the hall, anything else sends the visitor back to the tube. Randomness is
  // the browser's crypto source — nobody, including us, picks the stick.
  //
  // The ritual state lives in refs and is mirrored into React state for
  // rendering: two quick throws inside one render would otherwise both read
  // an empty `throws` and the count could never reach three (found in the
  // first browser test — a fast clicker was stuck at 1/3 forever).
  const stickRef = useRef<{ n: number; throws: Jiao[] } | null>(null)
  const ritualRef = useRef<'idle' | 'drawn' | 'rejected' | 'confirmed'>('idle')
  const setRitualBoth = (r: 'idle' | 'drawn' | 'rejected' | 'confirmed') => { ritualRef.current = r; setRitual(r) }
  const draw = () => {
    const s = { n: drawQian(cryptoRand), throws: [] as Jiao[] }
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

  const send = async () => {
    const q = input.trim()
    if (!q || busy || masters.length === 0) return
    setInput(''); setBusy(true); setErr(null)
    setTurns(ts => [...ts, { role: 'user', content: q }])

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
            ...subject(), question: q, modelId: m.id, history,
            search: search && ((m.output_config?.text?.capabilities ?? []) as string[]).includes('web_search'),
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

  const sel = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 13 }

  return (
    // The arena is 1200 wide because XBoard/XEval put tables in it. A birth
    // form and a reading are prose, so the room keeps its own 980 measure.
    <div style={{ maxWidth: 980 }}>
      <button onClick={onBack} style={{ border: 'none', background: 'none', color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer', padding: 0, marginBottom: 14 }}>
        ← {t('xtell.back')}
      </button>
      <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 14px' }}>{t(`xtell.${temple}.name`)}</h2>

      {!entered ? (
        <div style={{ ...card, padding: '18px 20px' }}>
          {temple === 'guandi' ? (
            <RitualPanel ask={ask} setAsk={setAsk} stick={stick} ritual={ritual} onDraw={draw} onThrow={throwBlocks} />
          ) : temple === 'yuelao' ? (
            <>
              <BirthRow label={t('xtell.person1')} value={birth} onChange={setBirth} sel={sel} />
              <div style={{ height: 12 }} />
              <BirthRow label={t('xtell.person2')} value={birth2} onChange={setBirth2} sel={sel} />
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
          {temple !== 'guandi' && (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted2)' }}>{t('xtell.solar.note')}</div>
              <span style={{ flex: 1 }} />
              <button onClick={() => void enter()} style={{
                padding: '10px 26px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff',
                fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
              }}>{t('xtell.enter')}</button>
            </div>
          )}
          {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 12.5 }}>⚠ {err}</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Masters row: chips, up to two. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {masters.map(m => (
              <span key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 999,
                border: '1px solid var(--border2)', background: 'var(--surface)', fontSize: 12.5,
              }}>
                <ProviderLogo provider={m.provider} size={14} />
                <b>{m.display_name}</b>
                {masters.length > 1 && (
                  <button onClick={() => setMasters(ms => ms.filter(x => x.id !== m.id))}
                    style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: 11 }}>✕</button>
                )}
              </span>
            ))}
            {masters.length < 2 && (
              <button onClick={() => setPickerOpen(true)} style={{
                padding: '7px 12px', borderRadius: 999, border: '1px dashed var(--border2)',
                background: 'none', color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer',
              }}>＋ {t('xtell.addmaster')}</button>
            )}
            {canSearch && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--muted)' }}>
                <input type="checkbox" checked={search} onChange={e => setSearch(e.target.checked)} />
                {t('xtell.search')}
              </label>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={() => setShowChart(v => !v)} style={{ border: 'none', background: 'none', color: 'var(--muted2)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline dotted' }}>
              {showChart ? t('xtell.hidechart') : t('xtell.viewchart')}
            </button>
          </div>

          {/* 月老廟's 合盤, above everything: it is free, it is computed, and it
              is what the two of them came to see. The reading interprets it. */}
          {match && <HeCard match={match} />}

          {/* The chart. Open by default, foldable for anyone who only wants
              the reading. */}
          {showChart && chart && (
            <div style={{ ...card, padding: '14px 16px' }}>
              {temple === 'bazi' ? <BaziBoard chart={chart} />
                : temple === 'ziwei' ? <ZiweiBoard chart={chart} />
                : temple === 'guandi' ? <QianCard qian={chart} />
                : temple === 'simianfo' ? <WishBoard chart={chart} wishes={wishes} year={year} />
                : temple === 'navagraha' ? <NavagrahaBoard chart={chart} />
                : (
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div><div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.person1')}</div><BaziBoard chart={chart.a} /></div>
                    <div><div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.person2')}</div><BaziBoard chart={chart.b} /></div>
                  </div>
                )}
              {engine && (
                <div style={{ ...mono, color: 'var(--muted2)', marginTop: 10 }}>{t('xtell.engine')}: {engine}</div>
              )}
            </div>
          )}

          {/* Conversation. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 120 }}>
            {turns.length === 0 && (
              <div style={{ padding: '16px 18px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.7 }}>
                {t(`xtell.${temple}.intro`)}
              </div>
            )}
            {/* Rounds: a user bubble, then every master's reply to it SIDE BY
                SIDE — and while two masters are seated, each reply carries a
                選這位老師 button that dismisses the other seat and continues
                the conversation with the chosen one. Same shape as XCreate:
                compare side by side, pick one to keep talking to. Past rounds
                keep their columns after a choice — they are the record of the
                comparison that led to it. */}
            {rounds(turns).map((round, ri) => (
              <div key={ri} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {round.user && (
                  <div style={{ alignSelf: 'flex-end', maxWidth: '82%', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 12, padding: '10px 14px', fontSize: 13.5, whiteSpace: 'pre-wrap' }}>
                    {round.user.content}
                  </div>
                )}
                {round.replies.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${round.replies.length}, 1fr)`, gap: 10, alignItems: 'start' }}>
                    {round.replies.map((tn: any, j: number) => (
                      <div key={j} style={{ background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 12, padding: '12px 16px', fontSize: 14, lineHeight: 1.85, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <ProviderLogo provider={tn.provider} size={13} />
                          <span style={{ ...mono, color: 'var(--muted2)' }}>{tn.name}</span>
                          {typeof tn.cost === 'number' && tn.cost > 0 && (
                            <span style={{ ...mono, color: 'var(--muted2)' }}>· ${tn.cost.toFixed(4)}</span>
                          )}
                          <span style={{ flex: 1 }} />
                          {masters.length > 1 && masters.some(m => m.id === tn.modelId) && (
                            <button onClick={() => !busy && setMasters(ms => ms.filter(x => x.id === tn.modelId))}
                              disabled={busy}
                              style={{ border: '1px solid var(--red)', background: 'none', color: 'var(--red)', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
                              {t('xtell.choose')}
                            </button>
                          )}
                        </div>
                        {/* Markdown, not pre-wrap. Models write 批文 with **bold**
                            and headings; rendering it raw printed the asterisks
                            at the reader. `markdown-body` + skipHtml is what
                            every other text surface here uses. */}
                        {tn.content
                          ? <div className="markdown-body" style={{ lineHeight: 1.85 }}><ReactMarkdown skipHtml>{tn.content}</ReactMarkdown></div>
                          : <span style={{ color: 'var(--muted2)' }}>…</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {err && <div style={{ color: 'var(--red)', fontSize: 12.5 }}>⚠ {err}</div>}

          {/* Composer — same shape as XDirect's. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
              placeholder={t('xtell.question.ph')}
              rows={4}
              style={{ flex: 1, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, resize: 'vertical' }}
            />
            <button onClick={() => void send()} disabled={busy || !input.trim()} style={{
              padding: '12px 20px', borderRadius: 10, border: 'none', background: 'var(--red)', color: 'var(--white)',
              fontWeight: 700, fontSize: 14, cursor: busy ? 'wait' : 'pointer',
              opacity: busy || !input.trim() ? 0.5 : 1,
            }}>{busy ? '…' : '→'}</button>
          </div>
        </div>
      )}

      {pickerOpen && (
        <ModelPickerDialog
          mode="text" recipeMode="text_to_text" feature="xtell" slotIds={masters.map(m => m.id)}
          onSelect={m => { setMasters(ms => (ms.some(x => x.id === m.id) || ms.length >= 2 ? ms : [...ms, m])); setPickerOpen(false) }}
          onClose={() => setPickerOpen(false)}
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
      <select style={sel} value={value.y} onChange={e => onChange({ ...value, y: +e.target.value })}>
        {Array.from({ length: 106 }, (_, i) => 2010 - i).map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.year')}</span>
      <select style={sel} value={value.m} onChange={e => onChange({ ...value, m: +e.target.value })}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.month')}</span>
      <select style={sel} value={value.d} onChange={e => onChange({ ...value, d: +e.target.value })}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.day')}</span>
      <select style={{ ...sel, opacity: value.hourUnknown ? 0.4 : 1 }} disabled={!!value.hourUnknown} value={value.h} onChange={e => onChange({ ...value, h: +e.target.value })}>
        {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
      </select>
      :
      <select style={{ ...sel, opacity: value.hourUnknown ? 0.4 : 1 }} disabled={!!value.hourUnknown} value={value.mi} onChange={e => onChange({ ...value, mi: +e.target.value })}>
        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(mi => <option key={mi} value={mi}>{String(mi).padStart(2, '0')}</option>)}
      </select>
      <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--muted2)' }}>{value.hourUnknown ? '—' : shichenOf(value.h)}</span>
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
function RitualPanel({ ask, setAsk, stick, ritual, onDraw, onThrow }: {
  ask: string; setAsk: (s: string) => void
  stick: { n: number; throws: Jiao[] } | null
  ritual: 'idle' | 'drawn' | 'rejected' | 'confirmed'
  onDraw: () => void; onThrow: () => void
}) {
  const t = useT()
  const pill = (bg: string) => ({ padding: '10px 26px', borderRadius: 999, border: 'none', background: bg, color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' })
  const jiaoColour: Record<Jiao, string> = { 聖筊: 'var(--green)', 笑筊: 'var(--muted)', 陰筊: 'var(--red)' }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xtell.qian.ask')}</div>
        <input value={ask} onChange={e => setAsk(e.target.value.slice(0, 300))} placeholder={t('xtell.qian.ask.ph')}
          disabled={ritual === 'confirmed'}
          style={{ width: '100%', background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 14px', color: 'var(--white)', fontSize: 14 }} />
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
                <span key={i} style={{
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
function QianCard({ qian }: { qian: any }) {
  const t = useT()
  const luckColour = /上|大/.test(qian.luck) ? 'var(--score-elite)' : /中/.test(qian.luck) ? 'var(--score-fair)' : 'var(--score-poor)'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 20, fontWeight: 800 }}>第{qian.n}籤　{qian.ganZhi}</div>
        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 18, fontWeight: 800, color: luckColour }}>{qian.luck}</div>
        {qian.story && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{qian.story}</div>}
      </div>
      <div style={{ padding: '18px 16px', background: 'var(--surface2)', borderRadius: 10, textAlign: 'center' }}>
        {qian.poem.map((l: string, i: number) => (
          <div key={i} style={{ fontFamily: 'var(--font-display), serif', fontSize: 22, fontWeight: 700, letterSpacing: 3, lineHeight: 1.8 }}>{l}</div>
        ))}
      </div>
      <div style={{ ...mono, color: 'var(--muted2)', margin: '14px 0 8px' }}>{t('xtell.qian.notes')}</div>
      <div style={{ display: 'grid', gap: 10 }}>
        {Object.entries(qian.sections as Record<string, string>).map(([name, text]) => (
          <div key={name} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 10, fontSize: 13, lineHeight: 1.7 }}>
            <b style={{ color: 'var(--muted)' }}>{name}</b>
            <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, lineHeight: 1.6 }}>{t('xtell.qian.source')}</div>
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
