'use client'
// app/xdev/DocsSections.tsx — the API reference, embedded in /xdev.
//
// One page for developers (owner, twice: "why a separate page?") — the
// reference lives UNDER the key dashboard, not on its own URL. Shaped like
// the references developers already trust (Stripe, OpenAI,
// Anthropic): a sticky section rail with scroll-spy on the left, one
// endpoint per section on the right — method chip, path, a parameter
// table with types and required flags, then a verified example with a
// copy button. The quickstart carries curl / Python / JS tabs; everything
// else shows the one language that best fits the point being made.
//
// Every example is real: run against production before being written
// down. When the API changes, this file changes in the same commit.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLang } from '../../lib/i18n'

// Keep technical examples in one place; only the surrounding explanation changes.
function useDocText() {
  const { lang } = useLang()
  return <T,>(en: T, ja: T): T => lang === 'ja' ? ja : en
}

const BASE = 'https://www.modelxd.com'

// ── section registry (drives the rail, the spy and the anchors) ─────────

const SECTIONS: Array<{ id: string; label: string; ja: string }> = [
  { id: 'quickstart',  label: 'Quickstart', ja: "クイックスタート" },
  { id: 'auth',        label: 'Authentication', ja: "認証" },
  { id: 'chat',        label: 'Chat completions', ja: "チャット生成" },
  { id: 'routing',     label: 'Models & routing', ja: "モデルとルーティング" },
  { id: 'structured',  label: 'Structured output', ja: "構造化出力" },
  { id: 'images',      label: 'Images', ja: "画像生成" },
  { id: 'videos',      label: 'Videos', ja: "動画生成" },
  { id: 'jobs',        label: 'Jobs', ja: "ジョブ" },
  { id: 'list-models', label: 'List models', ja: "モデル一覧" },
  { id: 'errors',      label: 'Errors', ja: "エラー" },
  { id: 'billing',     label: 'Billing & limits', ja: "料金と制限" },
  { id: 'usage',       label: 'Usage', ja: "利用履歴" },
  { id: 'mcp',         label: 'MCP for agents', ja: "エージェント向けMCP" },
]

// ── tiny building blocks ────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono), monospace', fontSize: '0.92em' }
const p: React.CSSProperties = { color: 'var(--muted)', fontSize: 'var(--docs-copy-size, 13.5px)', lineHeight: 'var(--docs-line-height, 1.65)', margin: '0 0 10px' }
const eyebrow: React.CSSProperties = {
  fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.09em',
  textTransform: 'uppercase', color: 'var(--muted)',
}

function MethodChip({ m }: { m: 'POST' | 'GET' }) {
  const color = m === 'POST' ? 'var(--red)' : 'var(--green)'
  const dim = m === 'POST' ? 'var(--red-dim)' : 'var(--green-dim)'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 6, background: dim, color,
      fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em',
    }}>{m}</span>
  )
}

function Endpoint({ method, path }: { method: 'POST' | 'GET'; path: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '2px 0 12px' }}>
      <MethodChip m={method} />
      <code style={{ ...mono, fontSize: 13.5, fontWeight: 700, wordBreak: 'break-all' }}>{path}</code>
    </div>
  )
}

function Req({ yes }: { yes?: boolean }) {
  const l = useDocText()
  return (
    <span style={{
      fontFamily: 'var(--font-mono), monospace', fontSize: 'var(--docs-label-size, 10px)', letterSpacing: '0.02em',
      color: yes ? 'var(--red)' : 'var(--muted2)', fontWeight: yes ? 700 : 400,
    }}>{yes ? l('required', '必須') : l('optional', '任意')}</span>
  )
}

/** Parameter table: name / type / required / description. */
function Params({ rows }: { rows: Array<[string, string, boolean, React.ReactNode]> }) {
  const l = useDocText()
  return (
    <div style={{ overflowX: 'auto', margin: '4px 0 12px' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480 }}>
        <thead>
          <tr>
            {[l('parameter', 'パラメータ'), l('type', '型'), '', l('description', '説明')].map((h, i) => (
              <th key={i} style={{ ...eyebrow, fontSize: 'var(--docs-label-size, 9.5px)', textAlign: 'left', padding: '0 14px 6px 0', borderBottom: '1px solid var(--border2)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, type, req, desc]) => (
            <tr key={name}>
              <td style={{ padding: '8px 14px 8px 0', fontFamily: 'var(--font-mono), monospace', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'top', borderBottom: '1px solid var(--border)' }}>{name}</td>
              <td style={{ padding: '8px 14px 8px 0', fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--muted2)', whiteSpace: 'nowrap', verticalAlign: 'top', borderBottom: '1px solid var(--border)' }}>{type}</td>
              <td style={{ padding: '8px 14px 8px 0', verticalAlign: 'top', borderBottom: '1px solid var(--border)' }}><Req yes={req} /></td>
              <td style={{ padding: '8px 0', color: 'var(--muted)', fontSize: 'var(--docs-table-size, 12.5px)', lineHeight: 'var(--docs-line-height, 1.55)', verticalAlign: 'top', borderBottom: '1px solid var(--border)' }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Code block with a copy button; optional label row above. */
function Code({ text, label }: { text: string; label?: string }) {
  const l = useDocText()
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ margin: '10px 0 0' }}>
      {label && <div style={{ ...eyebrow, marginBottom: 4 }}>{label}</div>}
      <div style={{ position: 'relative' }}>
        <pre style={{
          margin: 0, padding: '13px 15px', borderRadius: 10, border: '1px solid var(--border2)',
          background: 'var(--bg)', fontSize: 12, fontFamily: 'var(--font-mono), monospace',
          overflowX: 'auto', lineHeight: 1.6, whiteSpace: 'pre',
        }}>{text}</pre>
        <button
          onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          style={{
            position: 'absolute', top: 8, right: 8, padding: '3px 10px', borderRadius: 999,
            border: '1px solid var(--border2)', background: 'var(--surface)',
            color: copied ? 'var(--green)' : 'var(--muted)', fontSize: 11, cursor: 'pointer', fontWeight: 700,
          }}>{copied ? l('✓ copied', '✓ コピー済み') : l('copy', 'コピー')}</button>
      </div>
    </div>
  )
}

/** Tabbed code (quickstart): one tab per language, copy per tab. */
function CodeTabs({ tabs }: { tabs: Array<{ name: string; text: string }> }) {
  const [i, setI] = useState(0)
  return (
    <div style={{ margin: '10px 0 0' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {tabs.map((t, j) => (
          <button key={t.name} onClick={() => setI(j)} style={{
            padding: '3px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${i === j ? 'var(--red)' : 'var(--border2)'}`,
            background: i === j ? 'var(--red-dim)' : 'var(--surface)',
            color: i === j ? 'var(--red)' : 'var(--muted)',
          }}>{t.name}</button>
        ))}
      </div>
      <Code text={tabs[i].text} />
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="docs-section" style={{
      border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)',
      padding: 'var(--docs-section-padding, 20px 22px)', overflowWrap: 'anywhere', marginBottom: 18, scrollMarginTop: 84,
    }}>
      <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 10px' }}>{title}</h2>
      {children}
    </section>
  )
}

// ── the page ────────────────────────────────────────────────────────────

export default function DocsSections() {
  const l = useDocText()
  const { lang } = useLang()
  const [active, setActive] = useState('quickstart')
  const spyPaused = useRef(false)

  // Scroll-spy: the rail highlights the section under the reader. A click
  // pauses the spy briefly so the smooth-scroll doesn't flicker every
  // section it passes through.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        if (spyPaused.current) return
        const hit = entries.filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id)
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: 0 },
    )
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    }
    return () => obs.disconnect()
  }, [])

  // SMOOTH scrolls are dead on this site: html has scroll-behavior:smooth,
  // and something in the app cancels smooth scroll animations at frame zero
  // — measured live: scrollIntoView(), scrollTo() and location.hash all
  // moved scrollY by exactly 0, while behavior:'instant' works perfectly.
  // So the rail jumps instantly (Stripe's docs do the same), which also
  // reads better than a 5000px animated flight. scrollMarginTop on the
  // sections keeps headings clear of the sticky chrome.
  const jump = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    spyPaused.current = true
    setActive(id)
    el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' })
    setTimeout(() => { spyPaused.current = false }, 400)
  }

  return (
    <div id="docs" style={{ scrollMarginTop: 84,
      '--docs-copy-size': lang === 'ja' ? '16px' : '13.5px',
      '--docs-table-size': lang === 'ja' ? '14px' : '12.5px',
      '--docs-label-size': lang === 'ja' ? '12px' : undefined,
      '--docs-line-height': lang === 'ja' ? '1.75' : undefined,
    } as React.CSSProperties}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, margin: '34px 0 4px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{l('API reference', 'APIリファレンス')}</h2>
        <span style={{ ...eyebrow }}>{l('rest · mcp · verified examples', 'REST・MCP・実行確認済みの例')}</span>
      </div>
      <p style={{ ...p, maxWidth: 680, marginBottom: 20 }}>
                {l<React.ReactNode>(<>Everything below is the whole contract — every example has been run against production.
        Prices live on <Link href="/xboard" style={{ color: 'var(--red)' }}>XBoard</Link>.</>, <>APIの仕様と、本番環境で実行済みの例をまとめています。現在の料金は <Link href="/xboard" style={{ color: 'var(--red)' }}>XBoard</Link> で確認できます。</>)}
              </p>

      <div style={{ display: 'flex', gap: 26, alignItems: 'flex-start' }}>

          {/* ── sticky rail ── */}
          <nav style={{
            position: 'sticky', top: 84, flexShrink: 0, width: 172,
          }} className="docs-rail">
            {SECTIONS.map(s => (
              <a key={s.id} href={`#${s.id}`}
                onClick={(e) => { e.preventDefault(); jump(s.id) }}
                style={{
                  display: 'block', padding: '5px 10px', borderRadius: 7, fontSize: 12.5,
                  textDecoration: 'none', marginBottom: 1, fontWeight: active === s.id ? 700 : 400,
                  color: active === s.id ? 'var(--red)' : 'var(--muted)',
                  background: active === s.id ? 'var(--red-dim)' : 'transparent',
                  borderLeft: `2px solid ${active === s.id ? 'var(--red)' : 'transparent'}`,
                }}>{l(s.label, s.ja)}</a>
            ))}
          </nav>

          {/* ── content column ── */}
          <div style={{ flex: 1, minWidth: 0, maxWidth: 780 }}>

            <Section id="quickstart" title={l("Quickstart \u2014 first call in two minutes", "クイックスタート：2分で最初の呼び出し")}>
              <ol style={{ ...p, paddingLeft: 20, marginBottom: 4 }}>
                <li style={{ marginBottom: 4 }}>{l<React.ReactNode>(<>Sign in and mint a key on <Link href="/xdev" style={{ color: 'var(--red)' }}>/xdev</Link> — new accounts start with <strong>$10 free credit</strong>, no card.</>, <>ログインして <Link href="/xdev" style={{ color: 'var(--red)' }}>/xdev</Link> でキーを発行します。新規アカウントには<strong>10米ドル分の無料クレジット</strong>が付き、カード登録は不要です。</>)}</li>
                <li style={{ marginBottom: 4 }}>{l('Set a spend cap on the key (you can raise it later).', 'キーの利用上限額を設定します（後から変更できます）。')}</li>
                <li>{l('Make the call:', '次のコードで呼び出します。')}</li>
              </ol>
              <CodeTabs tabs={[
                { name: 'curl', text: `curl -s ${BASE}/api/v1/chat/completions \\
  -H "Authorization: Bearer xd_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "xd/auto",
    "messages": [{"role": "user", "content": "One sentence: why blind votes?"}]
  }'` },
                { name: 'Python', text: `from openai import OpenAI

client = OpenAI(base_url="${BASE}/api/v1", api_key="xd_...")

r = client.chat.completions.create(
    model="xd/auto",
    messages=[{"role": "user", "content": "One sentence: why blind votes?"}],
)
print(r.choices[0].message.content)
print(r.model)   # the model that actually answered
print(r.usage)   # includes cost_usd` },
                { name: 'JavaScript', text: `import OpenAI from 'openai'

const client = new OpenAI({ baseURL: '${BASE}/api/v1', apiKey: 'xd_...' })

const r = await client.chat.completions.create({
  model: 'xd/auto',
  messages: [{ role: 'user', content: 'One sentence: why blind votes?' }],
})
console.log(r.choices[0].message.content, r.model, r.usage)` },
              ]} />
              <p style={{ ...p, marginTop: 12, marginBottom: 0 }}>
                {l<React.ReactNode>(<>That's the whole integration: any OpenAI SDK, one base URL. There is no ModelXD SDK,
                deliberately — needing one would mean the compatibility failed.</>, <>OpenAI SDKとひとつのベースURLで接続できます。互換性を保つため、ModelXD専用SDKは必要ありません。</>)}
              </p>
            </Section>

            <Section id="auth" title={l("Authentication", "認証")}>
              <Code text={`Authorization: Bearer xd_...`} />
              <p style={{ ...p, marginTop: 12 }}>
                {l<React.ReactNode>(<>Keys are minted on <Link href="/xdev" style={{ color: 'var(--red)' }}>/xdev</Link>,
                shown once, stored hashed. Each key can carry a <strong>lifetime spend cap</strong>,
                enforced atomically <em>before</em> a call spends — ten concurrent requests cannot
                slip past it together.</>, <>キーは <Link href="/xdev" style={{ color: 'var(--red)' }}>/xdev</Link> で発行し、一度だけ表示されます。保存時はハッシュ化されます。キーごとに<strong>累計の利用上限額</strong>を設定でき、課金前に不可分な処理で確認します。同時に10件のリクエストを送っても、上限をすり抜けることはありません。</>)}
              </p>
              <p style={{ ...p, marginBottom: 0 }}>
                {l<React.ReactNode>(<><strong>Server-side only.</strong> The API sends no CORS headers, so a browser cannot
                call it — a key shipped in a client cannot be stolen from one. Keep the key on your
                server: game engine → your server → ModelXD.</>, <><strong>サーバー側で利用してください。</strong>APIはCORSヘッダーを返しません。キーはゲームやWebページのクライアントに埋め込まず、サーバーで保管してください。接続の流れは、ゲームエンジン → あなたのサーバー → ModelXDです。</>)}
              </p>
            </Section>

            <Section id="chat" title={l("Chat completions", "チャット生成")}>
              <Endpoint method="POST" path="/api/v1/chat/completions" />
              <p style={p}>
                {l<React.ReactNode>(<>Synchronous text inference, OpenAI-shaped in and out. Streaming via standard SSE.</>, <>テキスト生成は同期処理で、リクエストとレスポンスはOpenAI互換の形式です。標準のSSEによるストリーミングに対応します。</>)}
              </p>
              <Params rows={[
                ['model', 'string', true, l<React.ReactNode>(<>A model slug or routing verb — see <a href="#routing" style={{ color: 'var(--red)' }}>Models &amp; routing</a>. (Required unless <code style={mono}>models</code> is given.)</>, <>モデルID、またはルーティング指定。<a href="#routing" style={{ color: 'var(--red)' }}>モデルとルーティング</a>を参照。<code style={mono}>models</code> を指定しない場合は必須です。</>)],
                ['models', 'string[]', false, l<React.ReactNode>(<>Ordered fallback chain, e.g. <code style={mono}>{`["xai/grok-4.6", "xd/budget"]`}</code>. First model that answers wins; 429s and provider failures move down the chain. <code style={mono}>xd.fallbacks</code> in the response lists what was skipped and why.</>, <>順番に試すフォールバック先。例：<code style={mono}>{`["xai/grok-4.6", "xd/budget"]`}</code>。最初に応答したモデルを採用し、429やプロバイダの障害時は次へ進みます。省略したモデルと理由は <code style={mono}>xd.fallbacks</code> に入ります。</>)],
                ['messages', 'array', true, l<React.ReactNode>(<><code style={mono}>system</code> / <code style={mono}>user</code> / <code style={mono}>assistant</code>. The system message rides each provider's native system slot — and its prompt cache — never the message array.</>, <><code style={mono}>system</code> / <code style={mono}>user</code> / <code style={mono}>assistant</code>。システムメッセージは通常の会話配列ではなく、各プロバイダ専用のシステム欄に渡し、プロンプトキャッシュにも対応します。</>)],
                ['stream', 'boolean', false, l<React.ReactNode>(<>SSE chunks. The final chunk carries <code style={mono}>usage</code> including <code style={mono}>cost_usd</code> — no second request to learn the price. A request with a schema buffers instead (you cannot un-send a stream).</>, <>SSE形式で返します。最後のチャンクの <code style={mono}>usage</code> に <code style={mono}>cost_usd</code> を含むため、料金確認の再リクエストは不要です。スキーマ指定時は結果の検証が必要なため、バッファして返します。</>)],
                ['response_format', 'object', false, l<React.ReactNode>(<><code style={mono}>{`{"type": "json_schema", ...}`}</code>, enforced server-side — see <a href="#structured" style={{ color: 'var(--red)' }}>Structured output</a>.</>, <><code style={mono}>{`{"type": "json_schema", ...}`}</code>。サーバー側で検証します。<a href="#structured" style={{ color: 'var(--red)' }}>構造化出力</a>を参照。</>)],
                ['max_tokens', 'integer', false, l<React.ReactNode>('Output cap; a sane per-model default otherwise.', <>出力トークン数の上限。省略するとモデルごとの既定値を使用します。</>)],
                ['xd', 'object', false, l<React.ReactNode>(<><code style={mono}>{`{"effort": "low"|"medium"|"high"|"xhigh"|"max", "search": true}`}</code>. Effort maps to the provider's thinking level; search enables web search on capable models (billed per search on top of tokens). Standard clients simply omit this.</>, <><code style={mono}>{`{"effort": "low"|"medium"|"high"|"xhigh"|"max", "search": true}`}</code>。effortはプロバイダの推論レベルに対応します。searchは対応モデルのWeb検索を有効にし、トークン料金に検索ごとの料金が加わります。通常のクライアントでは省略できます。</>)],
              ]} />
              <p style={{ ...p, marginBottom: 0 }}>
                {l<React.ReactNode>(<><strong>Not supported, loudly:</strong> <code style={mono}>tools</code> /{' '}
                <code style={mono}>functions</code> / <code style={mono}>tool_choice</code> return an
                explicit <code style={mono}>400</code> rather than prose that ignores your functions.
                For agent decisions use <code style={mono}>response_format</code> — a filled-in form
                beats a function call.</>, <><strong>未対応の機能：</strong><code style={mono}>tools</code>、<code style={mono}>functions</code>、<code style={mono}>tool_choice</code> を指定すると、無視せず <code style={mono}>400</code> を返します。エージェントの判断結果を取得する場合は <code style={mono}>response_format</code> で構造化出力を指定してください。</>)}
              </p>
            </Section>

            <Section id="routing" title={l("Models & routing", "モデルとルーティング")}>
              <Params rows={[
                ['provider/model_name', 'slug', false, l<React.ReactNode>(<>Exactly that model — <code style={mono}>google/gemini-3.6-flash</code>, <code style={mono}>anthropic/claude-sonnet-5</code>. Discover ids via <a href="#list-models" style={{ color: 'var(--red)' }}>GET /api/v1/models</a>.</>, <>指定したモデルを利用します。例：<code style={mono}>google/gemini-3.6-flash</code>、<code style={mono}>anthropic/claude-sonnet-5</code>。IDは <a href="#list-models" style={{ color: 'var(--red)' }}>GET /api/v1/models</a> で取得できます。</>)],
                ['xd/auto', 'router', false, l<React.ReactNode>('Balanced — quality, price and measured first-token latency together. The everyday default.', <>品質・価格・実測の最初のトークンまでの時間を考慮した、日常利用向けのバランス型です。</>)],
                ['xd/fast', 'router', false, l<React.ReactNode>('Lowest measured time to first visible token, above a quality bar. Ranked on each model’s SLOWEST thinking setting, so the speed holds however you call it.', <>一定の品質を満たすモデルのうち、実測で最初のトークンが最も早く表示されるモデルを選びます。各モデルの最も遅い推論設定を基準に順位付けしています。</>)],
                ['xd/budget', 'router', false, l<React.ReactNode>('Cheapest by list price, above a quality bar. Routinely ~20× cheaper than xd/max; built for NPC crowds.', <>一定の品質を満たすモデルから、表示価格が最も安いものを選びます。通常はxd/maxより約20倍安く、大量のNPCなどを想定しています。価格差は固定ではありません。</>)],
                ['xd/max', 'router', false, l<React.ReactNode>('Highest blind-vote quality, price ignored entirely.', <>ブラインド投票の品質を最優先し、価格は選定に含めません。</>)],
              ]} />
              <p style={{ ...p }}>
                {l<React.ReactNode>(<>The resolved model always comes back in <code style={mono}>response.model</code> — you
                are never routed blind. An unknown, disabled, or API-blocked model is a{' '}
                <strong>404 naming the model</strong>, never a silent substitution.</>, <>実際に応答したモデルは、必ず <code style={mono}>response.model</code> で確認できます。存在しない、無効、またはAPI利用が制限されたモデルを指定した場合は、<strong>モデル名を含む404</strong>を返します。別のモデルへ黙って置き換えることはありません。</>)}
              </p>
              <p style={{ ...p, marginBottom: 0 }}>
                {l<React.ReactNode>(<><strong>Agents with memory: resolve once, pin after.</strong> Call{' '}
                <code style={mono}>xd/auto</code> when a character is created, read{' '}
                <code style={mono}>response.model</code>, pin that slug for the session — switching
                models mid-conversation throws away the prompt cache on a history that only grows.</>, <><strong>会話履歴を持つエージェントは、最初に選び、その後は固定。</strong>キャラクター作成時に <code style={mono}>xd/auto</code> を呼び、<code style={mono}>response.model</code> のモデルIDをセッションで使い続けます。会話の途中でモデルを切り替えると、蓄積した履歴のプロンプトキャッシュを利用できなくなります。</>)}
              </p>
            </Section>

            <Section id="structured" title={l("Structured output", "構造化出力")}>
              <p style={p}>
                {l<React.ReactNode>(<>Ask for a JSON schema and the reply either validates against it or the call fails
                with <code style={mono}>422</code> — never malformed text arriving at your validator
                as a surprise. One silent re-ask happens server-side first. The response's{' '}
                <code style={mono}>xd.structured_mode</code> reports the enforcement tier:{' '}
                <code style={mono}>native_schema</code> (constrained decoding),{' '}
                <code style={mono}>native_json</code> (JSON guaranteed, schema checked by us), or{' '}
                <code style={mono}>coaxed</code> (schema in the prompt, validated by us).</>, <>JSON Schemaを指定すると、スキーマに適合した結果、または <code style={mono}>422</code> を返します。検証できないテキストを成功として返すことはありません。サーバー側で一度再試行したうえで判定します。<code style={mono}>xd.structured_mode</code> は適用方式を示します。<code style={mono}>native_schema</code> は制約付きデコード、<code style={mono}>native_json</code> はJSON形式の保証とModelXDによるスキーマ検証、<code style={mono}>coaxed</code> はプロンプトでの指定とModelXDによる検証です。</>)}
              </p>
              <Code label={l("a game agent's decision — this exact request runs against production", 'ゲームエージェントの判断：本番環境で実行確認済みのリクエスト')} text={`{
  "model": "xd/budget",
  "messages": [
    {"role": "system", "content": "You are Rosa, a cautious farmer agent."},
    {"role": "user", "content": "<world snapshot JSON>"}
  ],
  "response_format": {"type": "json_schema", "json_schema": {
    "name": "decision",
    "schema": {
      "type": "object",
      "properties": {
        "action": {"enum": ["plant","water","harvest","store","move_to",
                            "steal","guard","chase","flee","idle"]},
        "target": {"type": "string"},
        "amount": {"type": "integer", "maximum": 10},
        "reason": {"type": "string"}
      },
      "required": ["action", "reason"],
      "additionalProperties": false
    }
  }},
  "xd": {"effort": "low"}
}`} />
              <p style={{ ...p, marginTop: 12, marginBottom: 0 }}>
                {l<React.ReactNode>(<>Provider schema dialects differ (one rejects <code style={mono}>maximum</code>,
                another requires every property in <code style={mono}>required</code>) — ModelXD
                adapts the schema per provider and validates your <em>original</em> on the way back,
                so one schema means one thing even across a fallback chain. The decision arrives as a
                JSON <em>string</em> in <code style={mono}>choices[0].message.content</code>: parse
                it, don't regex it.</>, <>プロバイダによってスキーマの扱いは異なります。たとえば <code style={mono}>maximum</code> を受け付けない場合や、全プロパティを <code style={mono}>required</code> に含める必要がある場合があります。ModelXDは送信時に形式を調整し、返却時には<strong>元のスキーマ</strong>で検証します。フォールバック先が変わっても検証条件は同じです。結果は <code style={mono}>choices[0].message.content</code> にJSON<strong>文字列</strong>として入るため、正規表現ではなくJSONパーサーで読み取ってください。</>)}
              </p>
            </Section>

            <Section id="images" title={l("Images", "画像生成")}>
              <Endpoint method="POST" path="/api/v1/images/generations" />
              <p style={p}>
                {l<React.ReactNode>(<>OpenAI-named so <code style={mono}>client.images.generate()</code> finds it — but{' '}
                <strong>async</strong>: the answer is a <code style={mono}>202</code> with a job id,
                not a finished file. Everything you can act on fails on <em>this</em> call — unknown
                model, empty prompt, exhausted balance, capped key — never as a job that dies later.</>, <><code style={mono}>client.images.generate()</code> から呼べるOpenAI形式のエンドポイントですが、処理は<strong>非同期</strong>です。完成した画像ではなく、ジョブIDを含む <code style={mono}>202</code> を返します。不明なモデル、空のプロンプト、残高不足、キーの利用上限など、事前に判定できるエラーはこの呼び出し時点で返します。</>)}
              </p>
              <Params rows={[
                ['prompt', 'string', true, l<React.ReactNode>('What to generate.', <>生成したい内容。</>)],
                ['model', 'string', true, l<React.ReactNode>(<>An image model slug, e.g. <code style={mono}>openai/gpt-image-2</code> — see <a href="#list-models" style={{ color: 'var(--red)' }}>?type=image</a>.</>, <>画像モデルのID。例：<code style={mono}>openai/gpt-image-2</code>。<a href="#list-models" style={{ color: 'var(--red)' }}>?type=image</a> で一覧を取得できます。</>)],
                ['aspect_ratio', 'string', false, l<React.ReactNode>(<>e.g. <code style={mono}>16:9</code>, <code style={mono}>1:1</code>, <code style={mono}>9:16</code>.</>, <>例：<code style={mono}>16:9</code>、<code style={mono}>1:1</code>、<code style={mono}>9:16</code>。</>)],
                ['size', 'string', false, l<React.ReactNode>(<>OpenAI's <code style={mono}>1024x1024</code> form, accepted as an alias so OpenAI SDKs work unchanged.</>, <>OpenAIの <code style={mono}>1024x1024</code> 形式も別名として受け付けるため、OpenAI SDKをそのまま利用できます。</>)],
                ['quality', 'string', false, l<React.ReactNode>(<><code style={mono}>low</code> / <code style={mono}>medium</code> / <code style={mono}>high</code>.</>, <><code style={mono}>low</code> / <code style={mono}>medium</code> / <code style={mono}>high</code>。</>)],
                ['n', 'integer', false, l<React.ReactNode>('Number of images, up to 4.', <>画像の枚数。最大4枚。</>)],
              ]} />
              <Code text={`POST ${BASE}/api/v1/images/generations
{ "model": "openai/gpt-image-2", "prompt": "a cheerful farm girl, low-poly",
  "aspect_ratio": "16:9", "quality": "high" }

→ 202 { "id": "3f2b…", "object": "image.generation.job",
        "status": "running", "poll": "/api/v1/jobs/3f2b…" }`} />
            </Section>

            <Section id="videos" title={l("Videos", "動画生成")}>
              <Endpoint method="POST" path="/api/v1/videos/generations" />
              <p style={p}>
                {l<React.ReactNode>(<>Same shape as images; video runs take minutes, so poll every ~15s.</>, <>画像と同じ形式です。動画生成には数分かかるため、約15秒間隔でジョブの状態を確認してください。</>)}
              </p>
              <Params rows={[
                ['prompt', 'string', true, l<React.ReactNode>('What to generate.', <>生成したい内容。</>)],
                ['model', 'string', true, l<React.ReactNode>(<>A video model slug — see <a href="#list-models" style={{ color: 'var(--red)' }}>?type=video</a>.</>, <>動画モデルのID。<a href="#list-models" style={{ color: 'var(--red)' }}>?type=video</a> で一覧を取得できます。</>)],
                ['duration', 'integer', false, l<React.ReactNode>('Seconds, 1–60, model-dependent range (commonly 4–15).', <>長さ（秒）。1〜60の範囲で、対応範囲はモデルによって異なります（一般的には4〜15秒）。</>)],
                ['aspect_ratio', 'string', false, l<React.ReactNode>(<>e.g. <code style={mono}>16:9</code>, <code style={mono}>9:16</code>.</>, <>例：<code style={mono}>16:9</code>、<code style={mono}>9:16</code>。</>)],
                ['resolution', 'string', false, l<React.ReactNode>(<>e.g. <code style={mono}>720p</code>, <code style={mono}>1080p</code> where the model offers tiers.</>, <>解像度を選べるモデルでは、例として <code style={mono}>720p</code>、<code style={mono}>1080p</code> を指定できます。</>)],
              ]} />
            </Section>

            <Section id="jobs" title={l("Jobs", "ジョブ")}>
              <Endpoint method="GET" path="/api/v1/jobs/{id}" />
              <Code text={`→ { "id": "3f2b…", "object": "image.generation.job",
    "status": "succeeded",            // running | succeeded | failed
    "model": "openai/gpt-image-2",
    "data": [ { "url": "https://…signed…" } ],
    "usage": { "cost_usd": 0.067 } }`} />
              <p style={{ ...p, marginTop: 12 }}>
                {l<React.ReactNode>(<><strong>Fetch <code style={mono}>url</code> promptly</strong> — generated files sit
                behind signed URLs that expire in ~24 hours. Everything also lands in your XCreate
                gallery, which never expires. On <code style={mono}>failed</code>, the job carries an{' '}
                <code style={mono}>error</code> message and costs nothing beyond what the provider
                actually burned.</>, <><strong><code style={mono}>url</code> のファイルは早めに取得してください。</strong>生成ファイルの署名付きURLは約24時間で期限切れになります。作品は有効期限のないXCreateギャラリーにも保存されます。<code style={mono}>failed</code> の場合は <code style={mono}>error</code> に理由が入り、プロバイダで実際に消費した分を超える料金は発生しません。</>)}
              </p>
              <Endpoint method="GET" path="/api/v1/jobs?type=image|video&limit=20" />
              <p style={{ ...p, marginBottom: 0 }}>
                {l<React.ReactNode>(<>Your recent generation jobs, newest first (limit ≤ 100). This is the recovery path:
                lose an id between the create and the first poll, and the job is still here — nothing
                has to be paid for twice. Files are not inlined; poll the one you want for a URL
                signed on the spot. Text runs are not listed — chat is synchronous and has no job.</>, <>最近の生成ジョブを新しい順に取得します（最大100件）。作成後にジョブIDを失った場合も、この一覧から復元でき、同じ生成に再度支払う必要はありません。一覧にはファイルを含まないため、対象ジョブを取得して、その時点で発行された署名付きURLを受け取ってください。テキスト生成は同期処理でジョブを作らないため、この一覧には含まれません。</>)}
              </p>
            </Section>

            <Section id="list-models" title={l("List models", "モデル一覧")}>
              <Endpoint method="GET" path="/api/v1/models?type=text|image|video" />
              <p style={p}>
                {l<React.ReactNode>(<>OpenAI-shaped (<code style={mono}>client.models.list()</code> works unchanged), and
                the only place a developer can discover ids like{' '}
                <code style={mono}>openai/gpt-image-2</code>. Every callable model is listed — text,
                image and video — each row carrying <code style={mono}>modalities</code>, an{' '}
                <code style={mono}>endpoint</code> naming where to send it, ModelXD's{' '}
                <code style={mono}>display_name</code>, <code style={mono}>pricing_usd_per_1m</code>{' '}
                (null for per-output-priced image/video models — honest, not missing), and{' '}
                <code style={mono}>capabilities</code>. The routers (<code style={mono}>xd/auto</code>,{' '}
                <code style={mono}>xd/budget</code>) appear under text.</>, <>OpenAI互換の形式で、<code style={mono}>client.models.list()</code> をそのまま利用できます。<code style={mono}>openai/gpt-image-2</code> などのモデルIDを取得するためのエンドポイントです。利用可能なテキスト・画像・動画モデルをすべて返します。各項目には <code style={mono}>modalities</code>、送信先の <code style={mono}>endpoint</code>、ModelXD上の <code style={mono}>display_name</code>、<code style={mono}>pricing_usd_per_1m</code>、<code style={mono}>capabilities</code> が含まれます。出力単位で課金する画像・動画モデルでは、100万トークンあたりの料金は欠落ではなく <code style={mono}>null</code> です。<code style={mono}>xd/auto</code>、<code style={mono}>xd/budget</code> などのルーターはテキストに分類されます。</>)}
              </p>
              <Code text={`{ "object": "list", "data": [
  { "id": "openai/gpt-5.6-sol", "object": "model", "owned_by": "openai",
    "display_name": "GPT-5.6 Sol",
    "pricing_usd_per_1m": { "input": 5, "output": 30 },
    "capabilities": { "web_search": true, "structured_output": true, "vision": true } },
  { "id": "xd/auto", "object": "model", "owned_by": "modelxd", "tags": ["router"] }
] }`} />
            </Section>

            <Section id="errors" title={l("Errors", "エラー")}>
              <p style={p}>
                {l<React.ReactNode>(<>OpenAI's envelope — <code style={mono}>{`{"error": {"message", "type", "code"}}`}</code>{' '}
                — so SDK error handling works unmodified. Retry <code style={mono}>429</code> /{' '}
                <code style={mono}>5xx</code> (429 carries <code style={mono}>Retry-After</code>);
                never retry other 4xx unchanged.</>, <>エラーはOpenAI形式の <code style={mono}>{`{"error": {"message", "type", "code"}}`}</code> で返すため、SDKのエラー処理をそのまま利用できます。<code style={mono}>429</code> と <code style={mono}>5xx</code> は再試行できます（429には <code style={mono}>Retry-After</code> が付きます）。それ以外の4xxは、リクエストを修正せずに繰り返さないでください。</>)}
              </p>
              <Params rows={[
                ['401', 'auth', false, l<React.ReactNode>('Missing or revoked key.', <>キーが指定されていない、または無効化されています。</>)],
                ['400', 'request', false, l<React.ReactNode>(<>Malformed request — including <code style={mono}>tools</code> (unsupported) and a bad <code style={mono}>response_format</code>.</>, <>リクエストの形式が不正です。未対応の <code style={mono}>tools</code> や、不正な <code style={mono}>response_format</code> も含みます。</>)],
                ['402', 'billing', false, l<React.ReactNode>(<><code style={mono}>insufficient_credits</code> (wallet empty) or <code style={mono}>spend_cap_reached</code> (this key's cap).</>, <><code style={mono}>insufficient_credits</code> は残高不足、<code style={mono}>spend_cap_reached</code> はキーの利用上限への到達を示します。</>)],
                ['404', 'model', false, l<React.ReactNode>('Unknown / disabled / blocked model, named in the message.', <>モデルが不明、無効、または利用制限中です。メッセージにモデル名が含まれます。</>)],
                ['422', 'schema', false, l<React.ReactNode>(<><code style={mono}>schema_unsatisfied</code> — the model couldn't match your schema after the internal retry. Loosen the schema or try another model.</>, <><code style={mono}>schema_unsatisfied</code>：内部再試行後もスキーマに適合しませんでした。スキーマの制約を緩めるか、別のモデルを試してください。</>)],
                ['429 / 5xx', 'transient', false, l<React.ReactNode>(<>Rate limited / provider failure — what <code style={mono}>models: [...]</code> fallback absorbs for you.</>, <>レート制限またはプロバイダの障害。<code style={mono}>models: [...]</code> のフォールバックで次のモデルを試せます。</>)],
              ]} />
            </Section>

            <Section id="billing" title={l("Billing & limits", "料金と制限")}>
              <p style={p}>
                {l<React.ReactNode>(<>Calls debit your ModelXD wallet at the model's <strong>listed price</strong> — the
                same number <Link href="/xboard" style={{ color: 'var(--red)' }}>XBoard</Link> shows,
                no API markup, ever. Every response reports its real cost in{' '}
                <code style={mono}>usage.cost_usd</code>, streams included. Prompt caching on
                Anthropic-family models is applied automatically — keep your system message
                byte-stable and the saving shows up in the price, not in extra fields.</>, <>料金はモデルの<strong>表示価格</strong>でModelXDウォレットから差し引きます。<Link href="/xboard" style={{ color: 'var(--red)' }}>XBoard</Link> と同じ価格で、APIによる追加料金はありません。ストリーミングを含む各レスポンスの <code style={mono}>usage.cost_usd</code> に実際の費用が入ります。Anthropic系モデルではプロンプトキャッシュを自動適用します。システムメッセージをバイト単位で同一に保つと、削減分が料金に反映されます。</>)}
              </p>
              <p style={{ ...p, marginBottom: 0 }}>
                {l<React.ReactNode>(<>Ten agents thinking concurrently on one key is the designed load — nothing
                serializes, and the spend cap stays exact under parallel calls. There is no
                per-request rate limit today; the cap and your balance are the wall. New accounts
                start with $10 free credit; top-ups are 1:1 on{' '}
                <Link href="/profile" style={{ color: 'var(--red)' }}>Profile</Link>. Spend by day,
                model and key is on this page and at <code style={mono}>GET /api/v1/usage</code>.</>, <>ひとつのキーで10体のエージェントが同時に処理する構成を想定しています。リクエストを直列化せず、並列実行中も利用上限を適用します。現時点ではリクエスト回数のレート制限はなく、キーの利用上限とウォレット残高が制限になります。新規アカウントには10米ドル分の無料クレジットが付き、<Link href="/profile" style={{ color: 'var(--red)' }}>プロフィール</Link> から1対1でチャージできます。日別・モデル別・キー別の費用は、このページと <code style={mono}>GET /api/v1/usage</code> で確認できます。</>)}
              </p>
            </Section>

            <Section id="usage" title={l("Usage \u2014 what your keys spent", "利用履歴：キーごとの費用")}>
              <p style={p}>
                {l<React.ReactNode>(<>Every call made with a key is recorded: endpoint, model, tokens, list-price cost and
                whether it failed (failures cost $0). Read it from code with the same key:</>, <>キーによる各呼び出しについて、エンドポイント、モデル、トークン数、表示価格に基づく費用、成否を記録します（失敗の記録は0米ドル）。同じキーを使ってコードから取得できます。</>)}
              </p>
              <Endpoint method="GET" path="/api/v1/usage" />
              <Code text={`curl -s "${BASE}/api/v1/usage?group_by=model&from=2026-09-01" \\
  -H "Authorization: Bearer $MODELXD_KEY"`} />
              <Params rows={[
                ['from / to', 'date', false, l<React.ReactNode>('UTC date or ISO time. Default: the last 30 days; a bare `to` date includes that whole day. Up to 366 days.', <>UTCの日付またはISO日時。既定値は直近30日で、日付のみのtoはその日全体を含みます。最大366日間。</>)],
                ['group_by', 'string', false, l<React.ReactNode>(<><code style={mono}>day</code> (default, zero-filled), <code style={mono}>model</code>, <code style={mono}>key</code>, <code style={mono}>surface</code>, or <code style={mono}>none</code> for the request log.</>, <><code style={mono}>day</code>（既定値、利用のない日も0で表示）、<code style={mono}>model</code>、<code style={mono}>key</code>、<code style={mono}>surface</code> で集計します。<code style={mono}>none</code> はリクエスト単位の履歴です。</>)],
                ['key', 'string', false, l<React.ReactNode>(<>A key id, or <code style={mono}>self</code> for the key making the request. Omit for all your keys.</>, <>キーID、または呼び出しに使ったキーを示す <code style={mono}>self</code>。省略すると自分のすべてのキーを対象にします。</>)],
                ['surface', 'string', false, l<React.ReactNode>(<><code style={mono}>chat</code>, <code style={mono}>image</code>, <code style={mono}>video</code> or <code style={mono}>3d</code>.</>, <><code style={mono}>chat</code>、<code style={mono}>image</code>、<code style={mono}>video</code>、<code style={mono}>3d</code>。</>)],
                ['limit / cursor', 'int / string', false, l<React.ReactNode>(<>Request-log paging (<code style={mono}>group_by=none</code>): up to 500 per page; pass <code style={mono}>next_cursor</code> back while <code style={mono}>has_more</code> is true.</>, <>リクエスト履歴（<code style={mono}>group_by=none</code>）のページ分割。1ページ最大500件。<code style={mono}>has_more</code> がtrueの間、<code style={mono}>next_cursor</code> を次のリクエストに渡します。</>)],
              ]} />
              <p style={{ ...p, marginBottom: 0 }}>
                {l<React.ReactNode>(<>The response carries <code style={mono}>totals</code> for the whole window (requests,
                failed, input and output tokens, <code style={mono}>cost_usd</code>) plus the grouped
                rows in <code style={mono}>data</code>. Prices before you call are in{' '}
                <code style={mono}>GET /api/v1/models</code>: per 1M tokens for text,{' '}
                <code style={mono}>pricing_usd_per_output</code> per image or per video second.</>, <>レスポンスの <code style={mono}>totals</code> には期間全体のリクエスト数、失敗数、入出力トークン数、<code style={mono}>cost_usd</code> が入り、<code style={mono}>data</code> に集計結果が入ります。実行前の料金は <code style={mono}>GET /api/v1/models</code> で確認できます。テキストは100万トークンあたり、画像・動画は <code style={mono}>pricing_usd_per_output</code> に画像1枚または動画1秒あたりの料金を返します。</>)}
              </p>
            </Section>

            <Section id="mcp" title={l("MCP \u2014 the same operations, for agent clients", "MCP：エージェントから同じ機能を利用")}>
              <p style={p}>
                {l<React.ReactNode>(<>Writing a program? Use the REST endpoints above. Connecting an <em>agent</em> that
                picks its own tools — Claude Code, Cursor, n8n? That's MCP. Same key, same billing:</>, <>プログラムからの呼び出しには上記のREST APIを使います。Claude Code、Cursor、n8nなど、自分でツールを選ぶ<strong>エージェント</strong>にはMCPで接続します。キーと課金は共通です。</>)}
              </p>
              <Code text={`claude mcp add --transport http modelxd ${BASE}/api/mcp \\
  --header "Authorization: Bearer xd_..."`} />
              <Params rows={[
                ['get_leaderboard', 'tool', false, l<React.ReactNode>('Models ranked by XD Score, with prices and provider/model_name ids.', <>XD Score順のモデル一覧。価格とprovider/model_name形式のIDを含みます。</>)],
                ['pick_model', 'tool', false, l<React.ReactNode>('Vote-backed recommendation for an image / video generation.', <>投票結果に基づいて、画像・動画生成向けのモデルを提案します。</>)],
                ['generate_image', 'tool', false, l<React.ReactNode>('Bills listed price. Fast models return outputs inline; slower ones a job_id.', <>表示価格で画像を生成します。速いモデルは結果を直接返し、時間のかかるモデルはjob_idを返します。</>)],
                ['generate_video', 'tool', false, l<React.ReactNode>('Always returns a job_id immediately.', <>動画生成のjob_idを即座に返します。</>)],
                ['check_job', 'tool', false, l<React.ReactNode>('Poll ~15s until outputs and the actual cost land.', <>約15秒間隔で確認し、生成結果と実際の費用を取得します。</>)],
                ['get_balance', 'tool', false, l<React.ReactNode>("Wallet balance plus this key's spend and cap.", <>ウォレット残高、このキーの利用額と利用上限を取得します。</>)],
              ]} />
              <p style={{ ...p, marginBottom: 0 }}>
                {l<React.ReactNode>(<>All outputs are AI-generated content — label them as such wherever they get
                published.</>, <>出力はすべてAIが生成したコンテンツです。公開する際は、AI生成であることを明示してください。</>)}
              </p>
            </Section>

            <p style={{ ...p, fontSize: 12.5, color: 'var(--muted2)' }}>
                {l<React.ReactNode>(<>Routing verbs and prices are live values, not promises — they move as votes land.
              Questions the docs don't answer: ask the agent on the{' '}
              <Link href="/" style={{ color: 'var(--red)' }}>home page</Link>.</>, <>ルーティング結果と料金は、投票などに応じて変わる現在の値です。将来の結果や価格を保証するものではありません。不明点は <Link href="/" style={{ color: 'var(--red)' }}>ホームページ</Link> のエージェントに相談できます。</>)}
              </p>
          </div>
      </div>

      {/* the rail folds away on narrow viewports — desktop-first, but no overlap */}
      <style>{`
        @media (max-width: 900px) { #docs .docs-rail { display: none } }
        @media (max-width: 480px) { #docs { --docs-section-padding: 16px 14px } }
      `}</style>
    </div>
  )
}
