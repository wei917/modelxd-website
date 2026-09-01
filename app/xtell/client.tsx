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

type Temple = 'bazi' | 'ziwei' | 'yuelao'

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
            {(['bazi', 'ziwei', 'yuelao'] as Temple[]).map(k => (
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

  const enter = async () => {
    setErr(null)
    try {
      const res = await fetch('/api/xtell/chart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temple, birth, ...(temple === 'yuelao' ? { birth2 } : {}) }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      setChart(d.chart)
      setMatch(d.match ?? null)
      setEngine(d.engine ?? null)
      setEntered(true)
      // 月老廟: the scores land free and instantly, so the only thing left to
      // ask is what they mean. Write the question for them but do NOT send it
      // — sending spends credits, and that stays a click the visitor makes.
      if (temple === 'yuelao') setInput(prev => prev || t('xtell.he.ask'))
    } catch (e: any) { setErr(String(e?.message ?? e)) }
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
            temple, birth, ...(temple === 'yuelao' ? { birth2 } : {}), question: q, modelId: m.id, history,
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
          {temple === 'yuelao' ? (
            <>
              <BirthRow label={t('xtell.person1')} value={birth} onChange={setBirth} sel={sel} />
              <div style={{ height: 12 }} />
              <BirthRow label={t('xtell.person2')} value={birth2} onChange={setBirth2} sel={sel} />
            </>
          ) : (
            <BirthRow value={birth} onChange={setBirth} sel={sel} allowUnknown={temple !== 'ziwei'} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>{t('xtell.solar.note')}</div>
            <span style={{ flex: 1 }} />
            <button onClick={enter} style={{
              padding: '10px 26px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff',
              fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
            }}>{t('xtell.enter')}</button>
          </div>
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
