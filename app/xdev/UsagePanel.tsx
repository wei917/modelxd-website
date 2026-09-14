'use client'
// app/xdev/UsagePanel.tsx — API usage on the XDev page: spend over time, by
// model, by key, and the request log. Everything comes from GET
// /api/v1/usage (session auth here; developers call the same endpoint with a
// key), so the page and the API can never disagree.
//
// Only the request log paginates (cursor, "Load more"): it is the one list
// that grows without bound. Day / model / key groupings are small by
// construction, and the key table above lists live keys only.

import { useCallback, useEffect, useState } from 'react'
import { useLang } from '../../lib/i18n'

type Totals = { requests: number; failed: number; input_tokens: number; output_tokens: number; cost_usd: number }
type KeyOpt = { id: string; name: string; token_prefix: string }
type View = 'day' | 'model' | 'key' | 'none'

const usd = (n: number) => n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
const num = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n)

export default function UsagePanel({ keys, card, label }: { keys: KeyOpt[]; card: React.CSSProperties; label: React.CSSProperties }) {
  const { t, lang } = useLang()
  const l = (en: string, ja: string) => lang === 'ja' ? ja : en
  const [days, setDays] = useState(30)
  const [keyId, setKeyId] = useState('')
  const [view, setView] = useState<View>('day')
  const [totals, setTotals] = useState<Totals | null>(null)
  const [data, setData] = useState<any[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const url = useCallback((more?: string | null) => {
    const to = new Date()
    const from = new Date(to.getTime() - days * 86_400_000)
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), group_by: view })
    if (keyId) q.set('key', keyId)
    if (view === 'none') { q.set('limit', '25'); if (more) q.set('cursor', more) }
    return `/api/v1/usage?${q}`
  }, [days, keyId, view])

  const load = useCallback(async (more?: string | null) => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(url(more))
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message ?? `HTTP ${r.status}`)
      setTotals(d.totals)
      setData(prev => more ? [...prev, ...d.data] : d.data)
      setCursor(d.next_cursor)
    } catch (e: any) { setErr(e?.message ?? 'Could not load usage') } finally { setLoading(false) }
  }, [url])
  useEffect(() => { load() }, [load])

  const chip = (on: boolean): React.CSSProperties => ({
    padding: '4px 11px', borderRadius: 999, fontSize: 11.5, cursor: 'pointer', fontWeight: 700,
    border: `1px solid ${on ? 'var(--red)' : 'var(--border2)'}`, background: on ? 'var(--surface2)' : 'transparent', color: 'var(--white)',
  })
  const th: React.CSSProperties = { ...label, padding: '6px 10px 6px 0', borderBottom: '1px solid var(--border)', textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '7px 10px 7px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5, whiteSpace: 'nowrap' }
  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono), monospace' }
  const max = Math.max(0.000001, ...data.map((d: any) => Number(d.cost_usd) || 0))

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>{l('📊 Usage', '📊 利用履歴')}</span>
        <span style={label}>{l('list price · same numbers as usage.cost_usd · GET /api/v1/usage', '表示価格で集計・usage.cost_usdと同じ値・GET /api/v1/usage')}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {[7, 30, 90].map(d => <button key={d} onClick={() => setDays(d)} style={chip(days === d)}>{d}{l(' days', '日間')}</button>)}
        <span style={{ width: 1, height: 18, background: 'var(--border2)', margin: '0 4px' }} />
        {([['day', l('Daily', '日別')], ['model', l('By model', 'モデル別')], ['key', l('By key', 'キー別')], ['none', l('Requests', 'リクエスト履歴')]] as [View, string][]).map(([v, l]) =>
          <button key={v} onClick={() => setView(v)} style={chip(view === v)}>{l}</button>)}
        <select aria-label={l('Filter by API key', 'APIキーで絞り込む')} value={keyId} onChange={e => setKeyId(e.target.value)} style={{ marginLeft: 'auto', padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 12 }}>
          <option value="">{l('All keys', 'すべてのキー')}</option>
          {keys.map(k => <option key={k.id} value={k.id}>{k.name} ({k.token_prefix})</option>)}
        </select>
      </div>

      {totals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
          {[
            [l('Spent', '利用額'), usd(totals.cost_usd)],
            [l('Requests', 'リクエスト数'), num(totals.requests)],
            [l('Failed', '失敗数'), num(totals.failed)],
            [l('Input tokens', '入力トークン'), num(totals.input_tokens)],
            [l('Output tokens', '出力トークン'), num(totals.output_tokens)],
          ].map(([k, v]) => (
            <div key={k} style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '9px 12px' }}>
              <div style={label}>{k}</div>
              <div style={{ ...mono, fontSize: 18, fontWeight: 700, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {err && <div style={{ color: 'var(--red)', fontSize: 12.5, marginBottom: 8 }}>{err === 'Could not load usage' ? l(err, '利用履歴を読み込めませんでした。') : err}</div>}
      {!err && totals?.requests === 0 && !loading && <div style={{ color: 'var(--muted2)', fontSize: 12.5 }}>{l('No API calls in this window yet.', 'この期間のAPI利用履歴はまだありません。')}</div>}

      {view === 'day' && totals && totals.requests > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, borderBottom: '1px solid var(--border)' }}>
            {data.map((d: any) => (
              <div key={d.date} title={`${d.date} · ${usd(d.cost_usd)} · ${d.requests}${l(' requests', '件')}`}
                style={{ flex: 1, minWidth: 2, height: `${Math.max(d.cost_usd > 0 ? 3 : 0, (d.cost_usd / max) * 100)}%`, background: 'var(--red)', borderRadius: '3px 3px 0 0', opacity: 0.85 }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...label, marginTop: 4 }}>
            <span>{data[0]?.date}</span><span>{l('max', '最大')} {usd(max)}{l(' / day', ' / 日')}</span><span>{data[data.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {(view === 'model' || view === 'key') && data.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{[view === 'model' ? l('model', 'モデル') : l('key', 'キー'), l('requests', '件数'), l('failed', '失敗'), l('input', '入力'), l('output', '出力'), l('spent', '利用額')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.map((d: any, i: number) => (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 700 }}>{view === 'model' ? d.model : <>{d.key_name ?? l('deleted key', '削除済みキー')} <span style={{ ...mono, color: 'var(--muted)', fontWeight: 400 }}>{d.key_prefix}{d.revoked ? l(' · revoked', ' · 無効化済み') : ''}</span></>}</td>
                  <td style={{ ...td, ...mono }}>{num(d.requests)}</td>
                  <td style={{ ...td, ...mono, color: d.failed ? 'var(--red)' : 'var(--muted)' }}>{d.failed}</td>
                  <td style={{ ...td, ...mono }}>{num(d.input_tokens)}</td>
                  <td style={{ ...td, ...mono }}>{num(d.output_tokens)}</td>
                  <td style={{ ...td, ...mono, fontWeight: 700 }}>{usd(d.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'none' && data.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{[l('time', '日時'), l('key', 'キー'), l('type', '種類'), l('model', 'モデル'), l('tokens in / out', '入力 / 出力トークン'), l('cost', '費用'), l('status', '状態')].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.map((d: any) => (
                <tr key={d.id}>
                  <td style={{ ...td, color: 'var(--muted2)' }}>{new Date(d.created_at).toLocaleString(lang === 'ja' ? 'ja-JP' : undefined)}</td>
                  <td style={td}>{d.key_name ?? '—'}</td>
                  <td style={td}>{lang === 'ja' ? ({ chat: 'チャット', image: '画像', video: '動画', '3d': '3D' } as Record<string, string>)[d.surface] ?? d.surface : d.surface}</td>
                  <td style={{ ...td, ...mono }}>{d.model}</td>
                  <td style={{ ...td, ...mono }}>{d.input_tokens == null ? '—' : `${num(d.input_tokens)} / ${num(d.output_tokens ?? 0)}`}</td>
                  <td style={{ ...td, ...mono, fontWeight: 700 }}>{usd(d.cost_usd)}</td>
                  <td style={{ ...td, color: d.status === 'failed' ? 'var(--red)' : 'var(--green)' }}>{lang === 'ja' ? ({ succeeded: '完了', failed: '失敗', running: '実行中' } as Record<string, string>)[d.status] ?? d.status : d.status}{d.error_code ? ` · ${d.error_code}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && <button disabled={loading} onClick={() => load(cursor)} style={{ ...chip(false), marginTop: 10 }}>{loading ? '…' : l('Load more', 'さらに表示')}</button>}
        </div>
      )}
      {loading && !data.length && <div style={{ color: 'var(--muted2)', fontSize: 12.5 }}>{t('common.loading')}</div>}
    </div>
  )
}
