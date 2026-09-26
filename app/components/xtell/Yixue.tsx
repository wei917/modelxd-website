'use client'

// 易學堂's pieces for the room (app/xtell/client.tsx wires them in):
//   HexagramGlyph — six lines drawn from data, never from an image model
//                   (an image model cannot be trusted to draw a hexagram);
//   YixueRitual   — the matter asked, then three coins thrown six times,
//                   the hexagram building from the bottom line up;
//   YixuePicker   — the 64 in King Wen order, for 查卦;
//   YixueBoard    — what was cast and which passage it reads, then the
//                   original text, every part labelled with its source.
// Original text is always shown in 「」 and marked 原文; computed things are
// marked as computed; interpretation belongs to the teacher's replies.

import type { CSSProperties } from 'react'
import { useT } from '../../../lib/i18n'
import {
  HEXAGRAMS, lineLabel, bitOf, isMoving, LINE_KIND, validLines,
  type Bit, type Coin, type LineValue,
} from '../../../lib/yijing-core'

const mono: CSSProperties = { fontFamily: 'var(--font-mono), monospace', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase' }
const quote: CSSProperties = { fontFamily: 'var(--font-display), serif', fontSize: 15, lineHeight: 1.75, color: 'var(--white)' }

/** Prepare a real question before choosing a teacher. Nothing is sent here. */
export function YixueQuestion({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean
}) {
  const t = useT()
  return <div style={{ display: 'grid', gap: 10 }}>
    <label style={{ display: 'grid', gap: 8 }}>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{t('xtell.yixue.question.label')}</span>
      <textarea value={value} onChange={e => onChange(e.target.value)} disabled={disabled} maxLength={2000} rows={5}
        placeholder={t('xtell.yixue.question.ph')} aria-describedby="yixue-question-help"
        style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 14px', background: '#ffffff', color: 'var(--white)', font: 'inherit', fontSize: 14, lineHeight: 1.7, resize: 'vertical' }} />
    </label>
    <p id="yixue-question-help" style={{ margin: 0, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.7 }}>{t('xtell.yixue.question.help')}</p>
    <p style={{ margin: 0, color: 'var(--muted2)', fontSize: 11.5, lineHeight: 1.7 }}>{t('xtell.yixue.question.prepare')}</p>
    <p style={{ margin: 0, color: 'var(--muted2)', fontSize: 11.5, lineHeight: 1.7 }}>{t('xtell.yixue.question.privacy')}</p>
  </div>
}

/** Recorded throws, in chronological/bottom-to-top order; never fill missing values. */
export function YixueManualCast({ ask, setAsk, values, onChange, onSubmit, disabled, sel }: {
  ask: string; setAsk: (value: string) => void
  values: Array<LineValue | ''>; onChange: (values: Array<LineValue | ''>) => void
  onSubmit: (values: LineValue[]) => void; disabled: boolean; sel: CSSProperties
}) {
  const t = useT()
  const ready = ask.trim().length > 0 && validLines(values)
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0, gap: 14 }}>
    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>{t('xtell.yixue.manual.help')}</p>
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t('xtell.yixue.ask')}</span>
      <input value={ask} maxLength={300} disabled={disabled} onChange={e => setAsk(e.target.value)}
        placeholder={t('xtell.yixue.ask.ph')} style={{ ...sel, width: '100%', boxSizing: 'border-box', fontSize: 14 }} />
    </label>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
      {Array.from({ length: 6 }, (_, i) => <label key={i} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 12.5 }}>{t('xtell.yixue.manual.line').replace('{n}', String(i + 1))}</span>
        <select value={values[i] ?? ''} disabled={disabled} style={{ ...sel, width: '100%', minWidth: 0 }}
          onChange={e => onChange(values.map((v, n) => n === i ? (e.target.value === '' ? '' : Number(e.target.value) as LineValue) : v))}>
          <option value="">{t('xtell.yixue.manual.choose')}</option>
          {([6, 7, 8, 9] as const).map(v => <option key={v} value={v}>{t(`xtell.yixue.manual.value.${v}`)}</option>)}
        </select>
      </label>)}
    </div>
    <p style={{ margin: 0, color: 'var(--muted2)', fontSize: 11.5, lineHeight: 1.7 }}>{t('xtell.yixue.manual.free')}</p>
    <button type="button" disabled={disabled || !ready} onClick={() => { if (!disabled && ask.trim() && validLines(values)) onSubmit([...values]) }}
      style={{ justifySelf: 'end', padding: '10px 22px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', font: 'inherit', fontWeight: 700, fontSize: 13.5, opacity: disabled || !ready ? 0.5 : 1, cursor: disabled || !ready ? 'not-allowed' : 'pointer' }}>
      {disabled ? '…' : t('xtell.yixue.manual.submit')}
    </button>
  </div>
}

/** Six lines, top line drawn first. Moving lines get the classical marks:
 *  ○ for 老陽 (9), × for 老陰 (6). */
export function HexagramGlyph({ lines, values, size = 44, highlight = [], label }: {
  lines: Bit[]; values?: LineValue[]; size?: number; highlight?: number[]; label?: string
}) {
  const w = size, bar = size * 0.1, gap = size * 0.08, mark = values ? size * 0.34 : 0
  const gapW = w * 0.18
  return (
    <svg width={w + mark} height={size} viewBox={`0 0 ${w + mark} ${size}`} role={label ? 'img' : undefined}
      aria-label={label} aria-hidden={label ? undefined : true} style={{ display: 'block', flex: 'none' }}>
      {[5, 4, 3, 2, 1, 0].map((i, row) => {
        const y = row * (bar + gap)
        const on = highlight.includes(i + 1)
        const fill = on ? 'var(--red)' : 'currentColor'
        const v = values?.[i]
        return (
          <g key={i}>
            {lines[i]
              ? <rect x={0} y={y} width={w} height={bar} rx={bar * 0.15} fill={fill} />
              : <><rect x={0} y={y} width={(w - gapW) / 2} height={bar} rx={bar * 0.15} fill={fill} />
                  <rect x={(w + gapW) / 2} y={y} width={(w - gapW) / 2} height={bar} rx={bar * 0.15} fill={fill} /></>}
            {v !== undefined && isMoving(v) && (
              // Centred on its own line, so the top line's mark is not clipped.
              <text x={w + mark * 0.55} y={y + bar / 2} dominantBaseline="central" fontSize={bar * 1.8} textAnchor="middle" fill="var(--red)">{v === 9 ? '○' : '×'}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ── 起卦 ────────────────────────────────────────────────────────────────────

export function YixueRitual({ ask, setAsk, values, coins, onThrow, onRetry, entering, failed, sel }: {
  ask: string; setAsk: (s: string) => void
  values: LineValue[]; coins: Coin[][]
  onThrow: () => void; onRetry: () => void
  entering: boolean; failed: boolean
  sel: CSSProperties
}) {
  const t = useT()
  const started = values.length > 0
  const done = values.length >= 6
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t('xtell.yixue.ask')}</span>
        {/* Locked once the first coin falls: 一事一占, the matter cannot change mid-cast. */}
        <input value={ask} maxLength={300} disabled={started} onChange={e => setAsk(e.target.value.slice(0, 300))}
          placeholder={t('xtell.yixue.ask.ph')} style={{ ...sel, fontSize: 14, opacity: started ? 0.75 : 1 }} />
      </label>
      <div style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.7 }}>{t('xtell.yixue.meng')}</div>

      {/* The hexagram builds from the bottom: row 6 on top, empty rows dashed. */}
      <div style={{ display: 'grid', gap: 6 }} aria-live="polite">
        {[6, 5, 4, 3, 2, 1].map(p => {
          const v = values[p - 1]
          const c = coins[p - 1]
          return (
            <div key={p} style={{ display: 'grid', gridTemplateColumns: '64px 92px minmax(0, 1fr)', alignItems: 'center', gap: 10, minHeight: 26 }}>
              <span style={{ ...mono, color: 'var(--muted2)' }}>{v === undefined ? t('xtell.yixue.throwOf').replace('{n}', String(p)) : lineLabel(p, bitOf(v))}</span>
              {v === undefined
                ? <span style={{ height: 8, borderTop: '2px dashed var(--border2)' }} />
                : <span style={{ display: 'flex', gap: 10 }}>
                    {bitOf(v)
                      ? <span style={{ flex: 1, height: 9, background: isMoving(v) ? 'var(--red)' : 'var(--white)', borderRadius: 2 }} />
                      : <><span style={{ flex: 1, height: 9, background: isMoving(v) ? 'var(--red)' : 'var(--white)', borderRadius: 2 }} />
                          <span style={{ flex: 1, height: 9, background: isMoving(v) ? 'var(--red)' : 'var(--white)', borderRadius: 2 }} /></>}
                  </span>}
              <span style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {c && <span aria-label={c.join('+')} style={{ display: 'inline-flex', gap: 4 }}>
                  {c.map((x, i) => <span key={i} style={{ width: 20, height: 20, borderRadius: 999, border: '1px solid var(--border2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'var(--font-mono), monospace' }}>{x}</span>)}
                </span>}
                {v !== undefined && <span>= {v} · {LINE_KIND[v]}{isMoving(v) ? ` ${v === 9 ? '○' : '×'}` : ''}</span>}
              </span>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--muted2)', flex: 1, minWidth: 220, lineHeight: 1.6 }}>{t('xtell.yixue.coins')}</span>
        {!done && (
          <button type="button" onClick={onThrow} disabled={!ask.trim()} style={{
            padding: '10px 22px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff',
            fontWeight: 700, fontSize: 13.5, cursor: ask.trim() ? 'pointer' : 'not-allowed', opacity: ask.trim() ? 1 : 0.5,
          }}>{t('xtell.yixue.throw')} {values.length + 1}/6</button>
        )}
        {done && failed && !entering && (
          <button type="button" onClick={onRetry} style={{
            padding: '10px 22px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
          }}>{t('xtell.yixue.retry')}</button>
        )}
        {done && entering && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>…</span>}
      </div>
      {!ask.trim() && !started && <div style={{ fontSize: 11.5, color: 'var(--muted2)' }}>{t('xtell.yixue.needask')}</div>}
    </div>
  )
}

// ── 查卦 ────────────────────────────────────────────────────────────────────

export function YixuePicker({ onPick, picked, disabled = false }: { onPick: (n: number) => void; picked: number | null; disabled?: boolean }) {
  const t = useT()
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ ...mono, color: 'var(--muted2)' }}>{t('xtell.yixue.pick')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))', gap: 6 }}>
        {HEXAGRAMS.map(h => (
          <button key={h.n} type="button" onClick={() => onPick(h.n)} disabled={disabled} aria-label={`${h.n} ${h.name}（${h.fullName}）`}
            aria-pressed={picked === h.n}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '8px 4px 7px', cursor: 'pointer',
              border: '1px solid ' + (picked === h.n ? 'var(--red)' : 'var(--border2)'), borderRadius: 8,
              background: picked === h.n ? 'var(--surface2)' : 'transparent', color: 'var(--white)', font: 'inherit',
            }}>
            <HexagramGlyph lines={h.lines} size={26} />
            <span style={{ fontSize: 11.5, lineHeight: 1.3 }}><span style={{ color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', marginRight: 3 }}>{h.n}</span>{h.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── The board ──────────────────────────────────────────────────────────────

type Yao = { label: string; text: string; xiaoxiang: string }
type HexBoard = {
  n: number; name: string; fullName: string; lower: string; upper: string; lines: Bit[]
  judgment: string; tuan: string; daxiang: string; yao: Yao[]; use?: Yao; wenyan?: string
  url: string; revid: number; corrections: Array<{ part: string; from: string; to: string; witness: string }>
}
type Focus = { hex: number; role: 'ben' | 'zhi'; kind: 'judgment' | 'line' | 'use'; position?: number; name?: string; primary?: boolean }

function HexHeading({ h, values, highlight, role }: { h: HexBoard; values?: LineValue[]; highlight?: number[]; role?: string }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <HexagramGlyph lines={h.lines} values={values} highlight={highlight} size={52} label={`${h.name}（${h.fullName}）`} />
      <div>
        {role && <div style={{ ...mono, color: 'var(--muted2)' }}>{role}</div>}
        <div style={{ fontFamily: 'var(--font-display), serif', fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>{h.name}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>{h.fullName}</span></div>
        <div style={{ fontSize: 12, color: 'var(--muted2)' }}>第 {h.n} 卦 · 下{h.lower}上{h.upper}</div>
      </div>
    </div>
  )
}

/** One passage: its label, the text in 「」, and the 小象 under a line. */
function Passage({ label, text, xiang, lead }: { label: string; text: string; xiang?: string; lead?: boolean }) {
  const t = useT()
  return (
    <div style={{ borderLeft: `3px solid ${lead ? 'var(--red)' : 'var(--border2)'}`, paddingLeft: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>{label}{lead ? `（${t('xtell.yixue.primary')}）` : ''}</div>
      <div style={quote}>「{text}」</div>
      {xiang && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{t('xtell.yixue.xiaoxiang')}：「{xiang}」</div>}
    </div>
  )
}

function focusPassage(f: Focus, ben: HexBoard, zhi: HexBoard | null, t: (k: string) => string) {
  const h = f.role === 'ben' ? ben : (zhi ?? ben)
  const where = `${t(f.role === 'ben' ? 'xtell.yixue.ben' : 'xtell.yixue.zhi')} ${h.name}`
  if (f.kind === 'judgment') return <Passage key={`${f.role}j`} label={`${where} · ${t('xtell.yixue.judgment')}`} text={h.judgment} lead={f.primary} />
  if (f.kind === 'use' && h.use) return <Passage key={`${f.role}u`} label={`${where} · ${h.use.label}`} text={h.use.text} xiang={h.use.xiaoxiang} lead={f.primary} />
  const y = h.yao[(f.position ?? 1) - 1]
  return <Passage key={`${f.role}${f.position}`} label={`${where} · ${y.label}`} text={y.text} xiang={y.xiaoxiang} lead={f.primary} />
}

/** The whole text of one hexagram, folded, with its provenance. */
function FullText({ h, open = false }: { h: HexBoard; open?: boolean }) {
  const t = useT()
  return (
    <details open={open} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <summary style={{ ...mono, color: 'var(--muted2)', cursor: 'pointer' }}>{t('xtell.yixue.fulltext')} · {h.name}</summary>
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <Passage label={t('xtell.yixue.judgment')} text={h.judgment} />
        <Passage label={t('xtell.yixue.tuan')} text={h.tuan} />
        <Passage label={t('xtell.yixue.daxiang')} text={h.daxiang} />
        {h.yao.map(y => <Passage key={y.label} label={y.label} text={y.text} xiang={y.xiaoxiang} />)}
        {h.use && <Passage label={h.use.label} text={h.use.text} xiang={h.use.xiaoxiang} />}
        {h.wenyan && (
          <details>
            <summary style={{ fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>{t('xtell.yixue.wenyan')}</summary>
            <div style={{ ...quote, fontSize: 14, whiteSpace: 'pre-line', marginTop: 8 }}>「{h.wenyan}」</div>
          </details>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.7 }}>
          {t('xtell.yixue.source')} · <a href={h.url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{h.name}</a> · rev {h.revid}
          {h.corrections.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer' }}>{t('xtell.yixue.corrections').replace('{n}', String(h.corrections.length))}</summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {h.corrections.map((c, i) => <li key={i}>{c.part}：「{c.from}」→「{c.to}」（{c.witness}）</li>)}
              </ul>
            </details>
          )}
        </div>
      </div>
    </details>
  )
}

export function YixueBoard({ chart, onExample }: { chart: any; onExample?: (q: string) => void }) {
  const t = useT()
  if (!chart) return null
  const legend = <div style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xtell.yixue.legend')}</div>

  if (chart.mode === 'ask') {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('xtell.yixue.examples')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[1, 2, 3, 4].map(i => (
            <button key={i} type="button" onClick={() => onExample?.(t(`xtell.yixue.ex${i}`))} style={{
              padding: '7px 12px', borderRadius: 999, border: '1px solid var(--border2)', background: 'transparent',
              color: 'var(--white)', fontSize: 12.5, cursor: 'pointer', font: 'inherit',
            }}>{t(`xtell.yixue.ex${i}`)}</button>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.7 }}>{t('xtell.yixue.question.basis')}</div>
      </div>
    )
  }

  if (chart.mode === 'lookup' && chart.hex) {
    const h: HexBoard = chart.hex
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        <HexHeading h={h} />
        {legend}
        <FullText h={h} open />
      </div>
    )
  }

  if (chart.mode !== 'cast' || !chart.ben) return null
  const ben: HexBoard = chart.ben, zhi: HexBoard | null = chart.zhi
  const values: LineValue[] = chart.values
  const rule = chart.rule
  const movingLabels: string[] = chart.moving.map((p: number) => lineLabel(p, bitOf(values[p - 1])))
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontSize: 13.5 }}><span style={{ color: 'var(--muted2)' }}>{t('xtell.yixue.ask')}：</span>{chart.ask}</div>
      <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
        <HexHeading h={ben} values={values} highlight={chart.moving} role={t('xtell.yixue.ben')} />
        {zhi && <span aria-hidden style={{ fontSize: 20, color: 'var(--muted2)' }}>→</span>}
        {zhi && <HexHeading h={zhi} role={t('xtell.yixue.zhi')} />}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
        {t('xtell.yixue.moving')}：{movingLabels.length ? movingLabels.join('、') : t('xtell.yixue.nomoving')}
        {chart.coins && <span style={{ marginLeft: 10, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', fontSize: 11 }}>
          {values.map((v: number, i: number) => `${['初', '二', '三', '四', '五', '上'][i]}${v}`).join(' ')}
        </span>}
      </div>

      {/* The rule, quoted from its source, and the passages it picks. */}
      <div style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 14px', display: 'grid', gap: 10 }}>
        <div style={{ ...mono, color: 'var(--muted2)' }}>{t('xtell.yixue.rule')}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>「{rule.text}」
          <span style={{ fontSize: 11.5, color: 'var(--muted2)' }}> · <a href={rule.source.url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{rule.source.title}</a>，{rule.source.edition}</span>
        </div>
        {rule.inferred && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('xtell.yixue.inferred')}</div>}
        {rule.count === 3 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t(rule.front ? 'xtell.yixue.front' : 'xtell.yixue.back')} {t('xtell.yixue.frontnote')}</div>}
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t('xtell.yixue.readthis')}</div>
        <div style={{ display: 'grid', gap: 12 }}>{(rule.focus as Focus[]).map(f => focusPassage(f, ben, zhi, t))}</div>
      </div>

      {legend}
      <FullText h={ben} />
      {zhi && <FullText h={zhi} />}
    </div>
  )
}
