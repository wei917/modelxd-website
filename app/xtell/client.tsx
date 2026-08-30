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

import { useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { useRequireAuth } from '../../lib/useRequireAuth'
import ModelPickerDialog, { type PickerModel } from '../components/ModelPickerDialog'
import ProviderLogo from '../components/ProviderLogo'

type Temple = 'bazi' | 'ziwei'

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
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '48px 24px 96px' }}>
      <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 8 }}>//XTELL · X算命</div>
      <h1 style={{ fontFamily: 'var(--font-display), inherit', fontWeight: 800, fontSize: 'clamp(26px, 4vw, 38px)', margin: '0 0 10px' }}>
        {t('xtell.title')}
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.65, maxWidth: 700, margin: '0 0 34px' }}>{t('xtell.sub')}</p>

      {!temple ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {(['bazi', 'ziwei'] as Temple[]).map(k => (
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
  )
}

function TempleRoom({ temple, onBack }: { temple: Temple; onBack: () => void }) {
  const t = useT()
  const [birth, setBirth] = useState({ y: 1990, m: 1, d: 1, h: 12, mi: 0, gender: 'male' as 'male' | 'female' })
  const [chart, setChart] = useState<any>(null)
  const [charting, setCharting] = useState(false)
  const [model, setModel] = useState<PickerModel | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState(false)
  const [question, setQuestion] = useState('')
  const [reading, setReading] = useState('')
  const [busy, setBusy] = useState(false)
  const [cost, setCost] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const readingRef = useRef<HTMLDivElement>(null)

  const canSearch = ((model?.output_config?.text?.capabilities ?? []) as string[]).includes('web_search')

  const compute = async () => {
    setCharting(true); setErr(null); setChart(null); setReading(''); setCost(null)
    try {
      const res = await fetch('/api/xtell/chart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temple, birth }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      setChart(d.chart)
    } catch (e: any) { setErr(String(e?.message ?? e)) }
    setCharting(false)
  }

  const consult = async () => {
    if (!model || busy) return
    setBusy(true); setErr(null); setReading(''); setCost(null)
    try {
      const res = await fetch('/api/xtell/reading', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temple, birth, question, modelId: model.id, search: search && canSearch }),
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
          if (type === 'delta') { setReading(r => r + j.text); readingRef.current?.scrollIntoView({ block: 'end' }) }
          if (type === 'done') setCost(j.cost ?? 0)
          if (type === 'error') setErr(j.message ?? 'error')
        }
      }
    } catch (e: any) { setErr(String(e?.message ?? e)) }
    setBusy(false)
  }

  const sel = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 13 }

  return (
    <div>
      <button onClick={onBack} style={{ border: 'none', background: 'none', color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer', padding: 0, marginBottom: 16 }}>
        ← {t('xtell.back')}
      </button>
      <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 16px' }}>{t(`xtell.${temple}.name`)}</h2>

      {/* ── 1. 稟明生辰 ── */}
      <div style={{ ...card, padding: '16px 18px', marginBottom: 14 }}>
        <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 10 }}>{t('xtell.step.birth')}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={sel} value={birth.y} onChange={e => setBirth({ ...birth, y: +e.target.value })}>
            {Array.from({ length: 106 }, (_, i) => 2010 - i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.year')}</span>
          <select style={sel} value={birth.m} onChange={e => setBirth({ ...birth, m: +e.target.value })}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.month')}</span>
          <select style={sel} value={birth.d} onChange={e => setBirth({ ...birth, d: +e.target.value })}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <span style={{ color: 'var(--muted2)', fontSize: 12 }}>{t('xtell.day')}</span>
          <select style={sel} value={birth.h} onChange={e => setBirth({ ...birth, h: +e.target.value })}>
            {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
          </select>
          :
          <select style={sel} value={birth.mi} onChange={e => setBirth({ ...birth, mi: +e.target.value })}>
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(mi => <option key={mi} value={mi}>{String(mi).padStart(2, '0')}</option>)}
          </select>
          <span style={{ ...mono, color: 'var(--muted2)' }}>{shichenOf(birth.h)}</span>
          <span style={{ width: 10 }} />
          {(['male', 'female'] as const).map(g => (
            <label key={g} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" checked={birth.gender === g} onChange={() => setBirth({ ...birth, gender: g })} />
              {t(`xtell.${g}`)}
            </label>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={compute} disabled={charting} style={{
            padding: '9px 22px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff',
            fontWeight: 700, fontSize: 13, cursor: charting ? 'wait' : 'pointer',
          }}>{charting ? '…' : t('xtell.compute')}</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 8 }}>{t('xtell.solar.note')}</div>
      </div>

      {/* ── 2. 排盤 ── */}
      {chart && (
        <div style={{ ...card, padding: '16px 18px', marginBottom: 14 }}>
          <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 10 }}>{t('xtell.step.chart')}</div>
          {temple === 'bazi' ? <BaziBoard chart={chart} /> : <ZiweiBoard chart={chart} />}
          <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 10 }}>{t('xtell.chart.note')}</div>
        </div>
      )}

      {/* ── 3. 請老師 ── */}
      {chart && (
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 10 }}>{t('xtell.step.master')}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <button onClick={() => setPickerOpen(true)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10,
              border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 13, cursor: 'pointer',
            }}>
              {model ? (<><ProviderLogo provider={model.provider} size={16} /><b>{model.display_name}</b></>) : t('xtell.pickmodel')}
            </button>
            {model && canSearch && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer', color: 'var(--muted)' }}>
                <input type="checkbox" checked={search} onChange={e => setSearch(e.target.checked)} />
                {t('xtell.search')}
              </label>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={consult} disabled={!model || busy} style={{
              padding: '10px 26px', borderRadius: 999, border: 'none',
              background: model && !busy ? 'var(--red)' : 'var(--border2)', color: '#fff',
              fontWeight: 700, fontSize: 13.5, cursor: model && !busy ? 'pointer' : 'default',
            }}>{busy ? t('xtell.consulting') : t('xtell.consult')}</button>
          </div>
          <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2}
            placeholder={t('xtell.question.ph')}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 13, resize: 'vertical' }} />

          {err && <div style={{ marginTop: 12, color: 'var(--red)', fontSize: 12.5 }}>⚠ {err}</div>}
          {reading && (
            <div ref={readingRef} style={{
              marginTop: 14, padding: '18px 20px', borderRadius: 10, background: 'var(--surface2)',
              border: '1px solid var(--border)', fontSize: 14, lineHeight: 1.9, whiteSpace: 'pre-wrap',
            }}>
              {reading}
              {cost != null && (
                <div style={{ ...mono, color: 'var(--muted2)', marginTop: 14 }}>
                  {model?.display_name} · ${cost.toFixed(4)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {pickerOpen && (
        <ModelPickerDialog
          mode="text" recipeMode="text_to_text" feature="xtell" slotIds={[model?.id ?? null]}
          onSelect={m => { setModel(m); setPickerOpen(false); setSearch(false) }}
          onClose={() => setPickerOpen(false)}
        />
      )}
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
