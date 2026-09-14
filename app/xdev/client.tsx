'use client'

import RouterTuner from '@/app/components/RouterTuner'
// app/xdev/client.tsx — XDev: API keys + the MCP connect guide.
//
// Two halves. KEYS: mint / cap / revoke, list via owner-read RLS (the
// browser client reads api_tokens directly, same pattern as user_credits).
// CONNECT: copy-paste blocks that are pre-filled with the freshly minted
// key while it is still in memory — the key is shown exactly once; after
// that the blocks fall back to a <YOUR_KEY> placeholder.

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowser } from '../../lib/supabase-client'
import { useAuthModal } from '../../lib/AuthModalContext'
import DocsSections from './DocsSections'
import UsagePanel from './UsagePanel'
import { useLang } from '../../lib/i18n'

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

const TOOL_JA: Record<string, string> = {
  "get_leaderboard": "実際のブラインド投票に基づくXD Score順のモデル一覧。料金も含みます。",
  "pick_model": "投票結果から画像・動画生成向けのモデルを提案します。テキストにはチャットAPIのxd/autoを使います。",
  "generate_image": "画像を生成し、結果またはjob_idを返します。",
  "generate_video": "動画を生成し、状態確認用のjob_idを返します。",
  "check_job": "生成結果と実際の費用が確定するまで、ジョブを確認します。",
  "get_balance": "クレジット残高と、このキーの利用額・上限額を取得します。"
}

export default function XDevClient() {
  const { t, lang } = useLang()
  const l = <T,>(en: T, ja: T): T => lang === 'ja' ? ja : en
  // PUBLIC page (owner, Sep 1: one developer page, docs readable before
  // signup). Instead of bouncing anonymous visitors to the auth modal on
  // load, the keys card itself asks for sign-in and everything else reads
  // fine logged-out.
  const { show: showAuth } = useAuthModal()
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
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
    const { data: { user } } = await sb.auth.getUser()
    setSignedIn(!!user)
    if (!user) { setRows([]); setLoading(false); return }
    const { data } = await sb.from('api_tokens')
      .select('id, name, token_prefix, spend_cap_usd, spent_usd, last_used_at, revoked_at, created_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
    setRows((data ?? []) as TokenRow[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const mint = async () => {
    if (signedIn === false) { showAuth('/xdev'); return }
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
    if (!confirm(t('xdev.revoke.confirm'))) return
    await fetch('/api/xdev/tokens', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (fresh?.id === id) setFresh(null)
    load()
  }

  const recap = async (id: string) => {
    const v = prompt(l('Spend cap in USD for this key (empty = uncapped):', 'このキーの利用上限額（米ドル、空欄＝上限なし）：'))
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
    `curl -s ${origin}/api/v1/chat/completions \\\n  -H "Authorization: Bearer ${keyShown}" -H "Content-Type: application/json" \\\n  -d '{"model":"xd/budget","messages":[{"role":"user","content":"One sentence: why blind votes?"}]}'`,
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
    fontSize: lang === 'ja' ? 12 : 10.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: lang === 'ja' ? 0 : '0.09em',
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
      }}>{copied === tag ? l('✓ copied', '✓ コピー済み') : l('copy', 'コピー')}</button>
    </div>
  )

  return (
    // overflowY visible: .xduel-page's overflow-y:auto breaks position:sticky
    // for the reference rail below (it pins to a scroll container that never
    // scrolls). Same override the standalone docs page needed.
    <div className="xduel-page" style={{ overflowY: 'visible' }}>
      <div className="arena xcreate-arena" style={{ maxWidth: 1100 }}>
        <span className="prompt-label eyebrow">XDEV</span>
        <h1 className="page-headline" style={{ marginBottom: 8 }}>{t('xdev.subtitle')}</h1>
        <p style={{ color: 'var(--muted)', fontSize: lang === 'ja' ? 16 : 14, lineHeight: 1.75, maxWidth: 640, marginBottom: 26 }}>
          {l<React.ReactNode>(<>Mint an API key and use it two ways: an OpenAI-compatible text API for your code and
          game servers, and an MCP server for agents — Claude Code, Cursor, n8n. Both run through
          the same pipeline, prices and wallet as the site. Every output is AI-generated content:
          label it as such wherever it gets published.</>, <>APIキーひとつで、2つの接続方法を利用できます。プログラムやゲームサーバーにはOpenAI互換のテキストAPI、Claude Code・Cursor・n8nなどのエージェントにはMCPを使います。処理の仕組み、料金、ウォレットはWebサイトと共通です。出力を公開する際は、AI生成であることを明示してください。</>)}
        </p>

        {/* ── Keys ─────────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>{l('🔑 API keys', '🔑 APIキー')}</span>
            <span style={{ ...label }}>{l('shown once · stored hashed · spend-capped', '一度だけ表示・ハッシュ化して保存・利用上限を設定')}</span>
          </div>

          {fresh && (
            <div style={{ border: '1.5px solid var(--green)', borderRadius: 10, padding: '12px 14px', marginBottom: 14, background: 'var(--surface2)' }}>
              <div style={{ fontSize: lang === 'ja' ? 14 : 12.5, fontWeight: 700, color: 'var(--green)', marginBottom: 4 }}>
                {l('Key created — copy it now. It will never be shown again.', 'キーを作成しました。今すぐコピーしてください。再表示はできません。')}
              </div>
              {codeBox(fresh.key, 'freshkey')}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            <input value={name} onChange={e => setName(e.target.value)} aria-label={l('API key name', 'APIキーの名前')} placeholder={l('key name (e.g. claude-code)', 'キー名（例：claude-code）')}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: lang === 'ja' ? 14 : 12.5, width: 200, maxWidth: '100%' }} />
            <input value={cap} onChange={e => setCap(e.target.value)} aria-label={l('Spend cap in USD', '利用上限額（米ドル）')} placeholder={l('spend cap $ (optional)', '利用上限（米ドル・任意）')} inputMode="decimal"
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: lang === 'ja' ? 14 : 12.5, width: 160, maxWidth: '100%' }} />
            <button onClick={mint} disabled={minting} style={{
              padding: '8px 20px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff',
              fontWeight: 800, fontSize: lang === 'ja' ? 14 : 12.5, cursor: minting ? 'default' : 'pointer', opacity: minting ? 0.5 : 1,
            }}>{t('xdev.createkey')}</button>
            {err && <span style={{ color: 'var(--red)', fontSize: 12 }}>{err === 'mint failed' ? l(err, 'キーを作成できませんでした。') : err}</span>}
          </div>

          {signedIn === false ? (
            <div style={{ color: 'var(--muted2)', fontSize: lang === 'ja' ? 14 : 12.5 }}>
              <button onClick={() => showAuth('/xdev')} style={{
                border: 'none', background: 'var(--red)', color: '#fff', borderRadius: 999,
                padding: '7px 18px', fontWeight: 800, fontSize: lang === 'ja' ? 14 : 12.5, cursor: 'pointer', marginRight: 10,
              }}>{t('xdev.signin.createkey')}</button>
              {l('New accounts start with $10 free credit — no card.', '新規アカウントには10米ドル分の無料クレジットが付き、カード登録は不要です。')}
            </div>
          ) : loading ? <div style={{ color: 'var(--muted2)', fontSize: lang === 'ja' ? 14 : 12.5 }}>{t('common.loading')}</div> : rows.length === 0 ? (
            <div style={{ color: 'var(--muted2)', fontSize: lang === 'ja' ? 14 : 12.5 }}>{l('No keys yet — create one to connect an agent.', 'キーはまだありません。作成するとエージェントを接続できます。')}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: lang === 'ja' ? 14 : 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {[l('name', '名前'), l('key', 'キー'), l('spent', '利用額'), l('cap', '上限額'), l('last used', '最終利用'), ''].map(h => (
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
                        <button onClick={() => recap(r.id)} title={l('edit cap', '利用上限を変更')} style={{ marginLeft: 6, border: 'none', background: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 11 }}>{l('edit', '変更')}</button>
                      </td>
                      <td style={{ padding: '8px 10px 8px 0', color: 'var(--muted2)' }}>{r.last_used_at ? new Date(r.last_used_at).toLocaleString(lang === 'ja' ? 'ja-JP' : undefined) : l('never', '未使用')}</td>
                      <td style={{ padding: '8px 0' }}>
                        <button onClick={() => revoke(r.id)} style={{ border: '1px solid var(--border2)', background: 'none', color: 'var(--red)', borderRadius: 999, padding: '3px 12px', fontSize: lang === 'ja' ? 13 : 11.5, cursor: 'pointer', fontWeight: 700 }}>{l('revoke', '無効化')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {signedIn && <UsagePanel keys={rows} card={card} label={label} />}

        {/* ── The router, made legible ──────────────────────────────────
            Directly above the Text API card, because "which model answers
            xd/auto?" is the first question the card provokes and the panel is
            the answer. It shows the live ranking, not a description of one. */}
        <div style={{ ...card, padding: 0, border: 'none', background: 'transparent' }}>
          <RouterTuner />
        </div>

        {/* ── Text API ─────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>{l('💬 Text API — OpenAI-compatible', '💬 テキストAPI — OpenAI互換')}</span>
            <span style={{ ...label }}>{l('chat · structured output · image & video jobs', 'チャット・構造化出力・画像と動画のジョブ')}</span>
            <a href="#docs" onClick={(e) => { e.preventDefault(); document.getElementById('docs')?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }) }} style={{
              marginLeft: 'auto', fontSize: lang === 'ja' ? 14 : 12.5, fontWeight: 800, color: '#fff',
              background: 'var(--red)', padding: '6px 16px', borderRadius: 999,
              textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer',
            }}>📖 {t('xdev.reference.link')} ↓</a>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: lang === 'ja' ? 14 : 12.5, marginBottom: 12 }}>
            {l<React.ReactNode>(<>Point any OpenAI SDK at this base URL and keep your code. <code>model</code> takes{' '}
            <code>provider/model_name</code> from the leaderboard, or let the votes decide:{' '}
            <code>xd/auto</code>, <code>xd/fast</code>, <code>xd/budget</code> or <code>xd/max</code>.
            The model that answered comes back in <code>response.model</code>, the real price in{' '}
            <code>usage.cost_usd</code> — on every response, streams included.</>, <>OpenAI SDKのベースURLを変更して、既存のコードを利用できます。<code>model</code> にはランキングの <code>provider/model_name</code> を指定するか、<code>xd/auto</code>、<code>xd/fast</code>、<code>xd/budget</code>、<code>xd/max</code> で選定を任せます。ストリーミングを含め、実際に応答したモデルは <code>response.model</code>、費用は <code>usage.cost_usd</code> に入ります。</>)}
          </p>

          <div style={label}>curl</div>
          {codeBox(chatCurl, 'chatcurl')}

          <div style={{ ...label, marginTop: 14 }}>{l('Python · any OpenAI SDK', 'Python・OpenAI SDKで接続')}</div>
          {codeBox(chatPy, 'chatpy')}

          <p style={{ color: 'var(--muted2)', fontSize: lang === 'ja' ? 13 : 11.5, marginTop: 12, marginBottom: 0 }}>
            {l<React.ReactNode>(<>For agents in games: <code>response_format</code> with a <code>json_schema</code> is
            enforced server-side — a reply either matches your schema or you get a 422, never
            malformed text. <code>{'models: [a, b]'}</code> is an ordered fallback chain. Images and
            video are REST too: <code>POST /api/v1/images/generations</code> → poll{' '}
            <code>/api/v1/jobs/{'{id}'}</code>. Server-side keys only: there is no browser CORS, by design.</>, <>ゲーム内エージェントの判断には、<code>response_format</code> と <code>json_schema</code> で構造化出力を指定します。サーバー側で検証し、適合した結果または422を返します。<code>{'models: [a, b]'}</code> は指定順のフォールバックです。画像・動画もREST APIで扱えます：<code>POST /api/v1/images/generations</code> の後に <code>/api/v1/jobs/{'{id}'}</code> で状態を確認します。キーはサーバー側だけで利用してください。ブラウザー向けのCORSには対応していません。</>)}
          </p>
        </div>

        {/* ── Connect ──────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{l('🔌 MCP — for agent clients', '🔌 MCP — エージェントを接続')}</div>
          <p style={{ color: 'var(--muted)', fontSize: lang === 'ja' ? 14 : 12.5, marginBottom: 12 }}>
            {fresh ? l('Commands below carry your new key — paste and go.', '下のコマンドには作成したキーが入っています。コピーして利用できます。') : l('Create a key above and these fill in automatically; or replace <YOUR_KEY> by hand.', '上でキーを作成すると自動入力されます。<YOUR_KEY>を手動で置き換えることもできます。')}
          </p>

          <div style={label}>Claude Code</div>
          {codeBox(claudeCmd, 'claude')}

          <div style={{ ...label, marginTop: 14 }}>{l('Cursor · Cline · anything that takes an MCP JSON config', 'Cursor・Clineなど、MCPのJSON設定に対応するクライアント')}</div>
          {codeBox(cursorJson, 'cursor')}

          <div style={{ ...label, marginTop: 14 }}>{l('Smoke test (no client needed)', '接続確認（専用クライアント不要）')}</div>
          {codeBox(curlCmd, 'curl')}
        </div>

        {/* ── Tools ────────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>{l('🧰 The tools your agent gets', '🧰 エージェントが使えるツール')}</div>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 360, borderCollapse: 'collapse', fontSize: lang === 'ja' ? 14 : 12.5 }}>
            <tbody>
              {TOOLS.map(([n, d]) => (
                <tr key={n}>
                  <td style={{ padding: '6px 14px 6px 0', fontFamily: 'var(--font-mono), monospace', fontWeight: 700, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{n}</td>
                  <td style={{ padding: '6px 0', color: 'var(--muted)' }}>{l(d, TOOL_JA[n] ?? d)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p style={{ color: 'var(--muted2)', fontSize: lang === 'ja' ? 13 : 11.5, marginTop: 12, marginBottom: 0 }}>
            {l<React.ReactNode>(<>Generations land in your XCreate gallery and Profile ledger like any other run. The spend
            cap is per key and lifetime, enforced up front: a call that would cross it is refused
            before it spends.</>, <>生成結果はXCreateギャラリーに、費用はプロフィールの利用履歴に表示されます。利用上限はキーごとの累計額に適用されます。上限を超える呼び出しは、費用が発生する前に拒否されます。</>)}
          </p>
        </div>

        {/* ── The API reference, same page (owner: one developer page) ── */}
        <DocsSections />
      </div>
    </div>
  )
}
