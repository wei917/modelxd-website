'use client'
// app/xdev/client.tsx — XDev: API keys + the MCP connect guide.
//
// Two halves. KEYS: mint / cap / revoke, list via owner-read RLS (the
// browser client reads api_tokens directly, same pattern as user_credits).
// CONNECT: copy-paste blocks that are pre-filled with the freshly minted
// key while it is still in memory — the key is shown exactly once; after
// that the blocks fall back to a <YOUR_KEY> placeholder.

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowser } from '../../lib/supabase-client'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useT } from '../../lib/i18n'

type TokenRow = {
  id: string
  name: string
  token_prefix: string
  spend_cap_usd: number | null
  spent_usd: number
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

const TOOLS: Array<[string, string]> = [
  ['get_leaderboard', 'models ranked by XD Score from real blind votes, with prices'],
  ['pick_model', 'vote-backed recommendation for an image / video generation (for text, call the chat API with xd/auto)'],
  ['generate_image', 'generate a still — returns outputs or a job_id'],
  ['generate_video', 'generate a video — returns a job_id to poll'],
  ['check_job', 'poll a generation until its outputs and actual cost land'],
  ['get_balance', 'credit balance plus this key’s spend and cap'],
]

export default function XDevClient() {
  const t = useT()
  useRequireAuth()
  const [rows, setRows] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [cap, setCap] = useState('')
  const [minting, setMinting] = useState(false)
  const [fresh, setFresh] = useState<{ key: string; id: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // The CANONICAL endpoint, not the host being browsed. These snippets get
  // pasted into game configs and CI — someone reading this page on
  // dev.modelxd.com (or localhost) must not ship the beta host into their
  // game. The constant also ends the SSR/client hydration dance a
  // window.location read here caused (caught live, Aug 27). One Supabase
  // behind every host, so a key works on www regardless of where it was
  // minted.
  const origin = 'https://www.modelxd.com'
  const keyShown = fresh?.key ?? '<YOUR_KEY>'

  const load = async () => {
    const sb = createSupabaseBrowser()
    const { data } = await sb.from('api_tokens')
      .select('id, name, token_prefix, spend_cap_usd, spent_usd, last_used_at, revoked_at, created_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
    setRows((data ?? []) as TokenRow[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const mint = async () => {
    setMinting(true); setErr(null)
    try {
      const res = await fetch('/api/xdev/tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'default', spend_cap_usd: cap === '' ? null : Number(cap) }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.message ?? body?.error ?? 'mint failed')
      setFresh({ key: body.key, id: body.id })
      setName(''); setCap('')
      load()
    } catch (e: any) { setErr(e?.message ?? 'mint failed') }
    finally { setMinting(false) }
  }

  const revoke = async (id: string) => {
    if (!confirm('Revoke this key? Agents using it stop working immediately.')) return
    await fetch('/api/xdev/tokens', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (fresh?.id === id) setFresh(null)
    load()
  }

  const recap = async (id: string) => {
    const v = prompt('Spend cap in USD for this key (empty = uncapped):')
    if (v === null) return
    await fetch('/api/xdev/tokens', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, spend_cap_usd: v.trim() === '' ? null : Number(v) }) })
    load()
  }

  const copy = (text: string, tag: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(tag)
    setTimeout(() => setCopied(c => (c === tag ? null : c)), 1600)
  }

  const chatCurl = useMemo(() =>
    `curl -s ${origin}/api/v1/chat/completions \\\n  -H "Authorization: Bearer ${keyShown}" -H "Content-Type: application/json" \\\n  -d '{"model":"xd/cheap","messages":[{"role":"user","content":"One sentence: why blind votes?"}]}'`,
    [origin, keyShown])
  const chatPy = useMemo(() =>
    `from openai import OpenAI\nclient = OpenAI(base_url="${origin}/api/v1", api_key="${keyShown}")\nr = client.chat.completions.create(model="xd/auto", messages=[{"role": "user", "content": "hi"}])\nprint(r.choices[0].message.content, r.usage)`,
    [origin, keyShown])
  const claudeCmd = useMemo(() =>
    `claude mcp add --transport http modelxd ${origin}/api/mcp --header "Authorization: Bearer ${keyShown}"`,
    [origin, keyShown])
  const curlCmd = useMemo(() =>
    `curl -s ${origin}/api/mcp -H "Authorization: Bearer ${keyShown}" -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    [origin, keyShown])
  const cursorJson = useMemo(() => JSON.stringify({
    mcpServers: { modelxd: { url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${keyShown}` } } },
  }, null, 2), [origin, keyShown])

  const label: React.CSSProperties = {
    fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.09em',
    textTransform: 'uppercase', color: 'var(--muted)',
  }
  const card: React.CSSProperties = {
    border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)',
    padding: '18px 20px', marginBottom: 18,
  }
  const codeBox = (text: string, tag: string) => (
    <div style={{ position: 'relative', marginTop: 8 }}>
      <pre style={{
        margin: 0, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border2)',
        background: 'var(--bg)', fontSize: 12, fontFamily: 'var(--font-mono), monospace',
        overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.55,
      }}>{text}</pre>
      <button onClick={() => copy(text, tag)} style={{
        position: 'absolute', top: 8, right: 8, padding: '3px 10px', borderRadius: 999,
        border: '1px solid var(--border2)', background: 'var(--surface)', color: copied === tag ? 'var(--green)' : 'var(--muted)',
        fontSize: 11, cursor: 'pointer', fontWeight: 700,
      }}>{copied === tag ? '✓ copied' : 'copy'}</button>
    </div>
  )

  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena">
        <span className="prompt-label eyebrow">XDEV</span>
        <h1 className="page-headline" style={{ marginBottom: 8 }}>{t('xdev.subtitle')}</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, maxWidth: 640, marginBottom: 26 }}>
          Mint an API key and use it two ways: an OpenAI-compatible text API for your code and
          game servers, and an MCP server for agents — Claude Code, Cursor, n8n. Both run through
          the same pipeline, prices and wallet as the site. Every output is AI-generated content:
          label it as such wherever it gets published.
        </p>

        {/* ── Keys ─────────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>🔑 API keys</span>
            <span style={{ ...label }}>shown once · stored hashed · spend-capped</span>
          </div>

          {fresh && (
            <div style={{ border: '1.5px solid var(--green)', borderRadius: 10, padding: '12px 14px', marginBottom: 14, background: 'var(--surface2)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--green)', marginBottom: 4 }}>
                Key created — copy it now. It will never be shown again.
              </div>
              {codeBox(fresh.key, 'freshkey')}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="key name (e.g. claude-code)"
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 12.5, width: 200 }} />
            <input value={cap} onChange={e => setCap(e.target.value)} placeholder="spend cap $ (optional)" inputMode="decimal"
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 12.5, width: 160 }} />
            <button onClick={mint} disabled={minting} style={{
              padding: '8px 20px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff',
              fontWeight: 800, fontSize: 12.5, cursor: minting ? 'default' : 'pointer', opacity: minting ? 0.5 : 1,
            }}>+ Create key</button>
            {err && <span style={{ color: 'var(--red)', fontSize: 12 }}>{err}</span>}
          </div>

          {loading ? <div style={{ color: 'var(--muted2)', fontSize: 12.5 }}>Loading…</div> : rows.length === 0 ? (
            <div style={{ color: 'var(--muted2)', fontSize: 12.5 }}>No keys yet — create one to connect an agent.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['name', 'key', 'spent', 'cap', 'last used', ''].map(h => (
                      <th key={h} style={{ ...label, padding: '6px 10px 6px 0', borderBottom: '1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td style={{ padding: '8px 10px 8px 0', fontWeight: 700 }}>{r.name}</td>
                      <td style={{ padding: '8px 10px 8px 0', fontFamily: 'var(--font-mono), monospace', color: 'var(--muted)' }}>{r.token_prefix}</td>
                      <td style={{ padding: '8px 10px 8px 0', fontFamily: 'var(--font-mono), monospace' }}>${Number(r.spent_usd).toFixed(2)}</td>
                      <td style={{ padding: '8px 10px 8px 0', fontFamily: 'var(--font-mono), monospace' }}>
                        {r.spend_cap_usd === null ? '—' : `$${Number(r.spend_cap_usd).toFixed(2)}`}
                        <button onClick={() => recap(r.id)} title="edit cap" style={{ marginLeft: 6, border: 'none', background: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 11 }}>edit</button>
                      </td>
                      <td style={{ padding: '8px 10px 8px 0', color: 'var(--muted2)' }}>{r.last_used_at ? new Date(r.last_used_at).toLocaleString() : 'never'}</td>
                      <td style={{ padding: '8px 0' }}>
                        <button onClick={() => revoke(r.id)} style={{ border: '1px solid var(--border2)', background: 'none', color: 'var(--red)', borderRadius: 999, padding: '3px 12px', fontSize: 11.5, cursor: 'pointer', fontWeight: 700 }}>revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Text API ─────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>💬 Text API — OpenAI-compatible</span>
            <span style={{ ...label }}>chat · structured output · image & video jobs</span>
            <a href="/xdev/docs" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--red)' }}>📖 Full API docs →</a>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 12 }}>
            Point any OpenAI SDK at this base URL and keep your code. <code>model</code> takes{' '}
            <code>provider/model_name</code> from the leaderboard, or let the votes decide:{' '}
            <code>xd/auto</code> (best XD Score) / <code>xd/cheap</code> (good enough, cheapest).
            The model that answered comes back in <code>response.model</code>, the real price in{' '}
            <code>usage.cost_usd</code> — on every response, streams included.
          </p>

          <div style={label}>curl</div>
          {codeBox(chatCurl, 'chatcurl')}

          <div style={{ ...label, marginTop: 14 }}>Python · any OpenAI SDK</div>
          {codeBox(chatPy, 'chatpy')}

          <p style={{ color: 'var(--muted2)', fontSize: 11.5, marginTop: 12, marginBottom: 0 }}>
            For agents in games: <code>response_format</code> with a <code>json_schema</code> is
            enforced server-side — a reply either matches your schema or you get a 422, never
            malformed text. <code>{'models: [a, b]'}</code> is an ordered fallback chain. Images and
            video are REST too: <code>POST /api/v1/images/generations</code> → poll{' '}
            <code>/api/v1/jobs/{'{id}'}</code>. Server-side keys only: there is no browser CORS, by design.
          </p>
        </div>

        {/* ── Connect ──────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>🔌 MCP — for agent clients</div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 12 }}>
            {fresh ? 'Commands below carry your new key — paste and go.' : 'Create a key above and these fill in automatically; or replace <YOUR_KEY> by hand.'}
          </p>

          <div style={label}>Claude Code</div>
          {codeBox(claudeCmd, 'claude')}

          <div style={{ ...label, marginTop: 14 }}>Cursor · Cline · anything that takes an MCP JSON config</div>
          {codeBox(cursorJson, 'cursor')}

          <div style={{ ...label, marginTop: 14 }}>Smoke test (no client needed)</div>
          {codeBox(curlCmd, 'curl')}
        </div>

        {/* ── Tools ────────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>🧰 The tools your agent gets</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <tbody>
              {TOOLS.map(([n, d]) => (
                <tr key={n}>
                  <td style={{ padding: '6px 14px 6px 0', fontFamily: 'var(--font-mono), monospace', fontWeight: 700, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{n}</td>
                  <td style={{ padding: '6px 0', color: 'var(--muted)' }}>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: 'var(--muted2)', fontSize: 11.5, marginTop: 12, marginBottom: 0 }}>
            Generations land in your XCreate gallery and Profile ledger like any other run. The spend
            cap is per key and lifetime, enforced up front: a call that would cross it is refused
            before it spends.
          </p>
        </div>
      </div>
    </div>
  )
}
