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

const BASE = 'https://www.modelxd.com'

// ── section registry (drives the rail, the spy and the anchors) ─────────

const SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'quickstart',  label: 'Quickstart' },
  { id: 'auth',        label: 'Authentication' },
  { id: 'chat',        label: 'Chat completions' },
  { id: 'routing',     label: 'Models & routing' },
  { id: 'structured',  label: 'Structured output' },
  { id: 'images',      label: 'Images' },
  { id: 'videos',      label: 'Videos' },
  { id: 'jobs',        label: 'Jobs' },
  { id: 'list-models', label: 'List models' },
  { id: 'errors',      label: 'Errors' },
  { id: 'billing',     label: 'Billing & limits' },
  { id: 'mcp',         label: 'MCP for agents' },
]

// ── tiny building blocks ────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono), monospace', fontSize: '0.92em' }
const p: React.CSSProperties = { color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.65, margin: '0 0 10px' }
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
  return (
    <span style={{
      fontFamily: 'var(--font-mono), monospace', fontSize: 10, letterSpacing: '0.06em',
      color: yes ? 'var(--red)' : 'var(--muted2)', fontWeight: yes ? 700 : 400,
    }}>{yes ? 'required' : 'optional'}</span>
  )
}

/** Parameter table: name / type / required / description. */
function Params({ rows }: { rows: Array<[string, string, boolean, React.ReactNode]> }) {
  return (
    <div style={{ overflowX: 'auto', margin: '4px 0 12px' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480 }}>
        <thead>
          <tr>
            {['parameter', 'type', '', 'description'].map((h, i) => (
              <th key={i} style={{ ...eyebrow, fontSize: 9.5, textAlign: 'left', padding: '0 14px 6px 0', borderBottom: '1px solid var(--border2)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, type, req, desc]) => (
            <tr key={name}>
              <td style={{ padding: '8px 14px 8px 0', fontFamily: 'var(--font-mono), monospace', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'top', borderBottom: '1px solid var(--border)' }}>{name}</td>
              <td style={{ padding: '8px 14px 8px 0', fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--muted2)', whiteSpace: 'nowrap', verticalAlign: 'top', borderBottom: '1px solid var(--border)' }}>{type}</td>
              <td style={{ padding: '8px 14px 8px 0', verticalAlign: 'top', borderBottom: '1px solid var(--border)' }}><Req yes={req} /></td>
              <td style={{ padding: '8px 0', color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.55, verticalAlign: 'top', borderBottom: '1px solid var(--border)' }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Code block with a copy button; optional label row above. */
function Code({ text, label }: { text: string; label?: string }) {
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
          }}>{copied ? '✓ copied' : 'copy'}</button>
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
    <section id={id} style={{
      border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)',
      padding: '20px 22px', marginBottom: 18, scrollMarginTop: 84,
    }}>
      <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 10px' }}>{title}</h2>
      {children}
    </section>
  )
}

// ── the page ────────────────────────────────────────────────────────────

export default function DocsSections() {
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
    <div id="docs" style={{ scrollMarginTop: 84 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '34px 0 4px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>API reference</h2>
        <span style={{ ...eyebrow }}>rest · mcp · verified examples</span>
      </div>
      <p style={{ ...p, maxWidth: 680, marginBottom: 20 }}>
        Everything below is the whole contract — every example has been run against production.
        Prices live on <Link href="/xboard" style={{ color: 'var(--red)' }}>XBoard</Link>.
      </p>

      <div style={{ display: 'flex', gap: 26, alignItems: 'flex-start' }}>

          {/* ── sticky rail ── */}
          <nav style={{
            position: 'sticky', top: 84, flexShrink: 0, width: 172,
            display: 'var(--docs-rail-display, block)' as any,
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
                }}>{s.label}</a>
            ))}
          </nav>

          {/* ── content column ── */}
          <div style={{ flex: 1, minWidth: 0, maxWidth: 780 }}>

            <Section id="quickstart" title="Quickstart — first call in two minutes">
              <ol style={{ ...p, paddingLeft: 20, marginBottom: 4 }}>
                <li style={{ marginBottom: 4 }}>Sign in and mint a key on <Link href="/xdev" style={{ color: 'var(--red)' }}>/xdev</Link> — new accounts start with <strong>$10 free credit</strong>, no card.</li>
                <li style={{ marginBottom: 4 }}>Set a spend cap on the key (you can raise it later).</li>
                <li>Make the call:</li>
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
                That's the whole integration: any OpenAI SDK, one base URL. There is no ModelXD SDK,
                deliberately — needing one would mean the compatibility failed.
              </p>
            </Section>

            <Section id="auth" title="Authentication">
              <Code text={`Authorization: Bearer xd_...`} />
              <p style={{ ...p, marginTop: 12 }}>
                Keys are minted on <Link href="/xdev" style={{ color: 'var(--red)' }}>/xdev</Link>,
                shown once, stored hashed. Each key can carry a <strong>lifetime spend cap</strong>,
                enforced atomically <em>before</em> a call spends — ten concurrent requests cannot
                slip past it together.
              </p>
              <p style={{ ...p, marginBottom: 0 }}>
                <strong>Server-side only.</strong> The API sends no CORS headers, so a browser cannot
                call it — a key shipped in a client cannot be stolen from one. Keep the key on your
                server: game engine → your server → ModelXD.
              </p>
            </Section>

            <Section id="chat" title="Chat completions">
              <Endpoint method="POST" path="/api/v1/chat/completions" />
              <p style={p}>
                Synchronous text inference, OpenAI-shaped in and out. Streaming via standard SSE.
              </p>
              <Params rows={[
                ['model', 'string', true, <>A model slug or routing verb — see <a href="#routing" style={{ color: 'var(--red)' }}>Models &amp; routing</a>. (Required unless <code style={mono}>models</code> is given.)</>],
                ['models', 'string[]', false, <>Ordered fallback chain, e.g. <code style={mono}>{`["xai/grok-4.6", "xd/cheap"]`}</code>. First model that answers wins; 429s and provider failures move down the chain. <code style={mono}>xd.fallbacks</code> in the response lists what was skipped and why.</>],
                ['messages', 'array', true, <><code style={mono}>system</code> / <code style={mono}>user</code> / <code style={mono}>assistant</code>. The system message rides each provider's native system slot — and its prompt cache — never the message array.</>],
                ['stream', 'boolean', false, <>SSE chunks. The final chunk carries <code style={mono}>usage</code> including <code style={mono}>cost_usd</code> — no second request to learn the price. A request with a schema buffers instead (you cannot un-send a stream).</>],
                ['response_format', 'object', false, <><code style={mono}>{`{"type": "json_schema", ...}`}</code>, enforced server-side — see <a href="#structured" style={{ color: 'var(--red)' }}>Structured output</a>.</>],
                ['max_tokens', 'integer', false, 'Output cap; a sane per-model default otherwise.'],
                ['xd', 'object', false, <><code style={mono}>{`{"effort": "low"|"medium"|"high"|"xhigh"|"max", "search": true}`}</code>. Effort maps to the provider's thinking level; search enables web search on capable models (billed per search on top of tokens). Standard clients simply omit this.</>],
              ]} />
              <p style={{ ...p, marginBottom: 0 }}>
                <strong>Not supported, loudly:</strong> <code style={mono}>tools</code> /{' '}
                <code style={mono}>functions</code> / <code style={mono}>tool_choice</code> return an
                explicit <code style={mono}>400</code> rather than prose that ignores your functions.
                For agent decisions use <code style={mono}>response_format</code> — a filled-in form
                beats a function call.
              </p>
            </Section>

            <Section id="routing" title="Models & routing">
              <Params rows={[
                ['provider/model_name', 'slug', false, <>Exactly that model — <code style={mono}>google/gemini-3.6-flash</code>, <code style={mono}>anthropic/claude-sonnet-5</code>. Discover ids via <a href="#list-models" style={{ color: 'var(--red)' }}>GET /api/v1/models</a>.</>],
                ['xd/auto', 'router', false, 'The highest XD Score on the text board — the model real blind votes say is best right now.'],
                ['xd/cheap', 'router', false, 'Among models at or above the board’s median score, the cheapest by list price. Routinely ~10× cheaper than xd/auto; built for NPC crowds.'],
              ]} />
              <p style={{ ...p }}>
                The resolved model always comes back in <code style={mono}>response.model</code> — you
                are never routed blind. An unknown, disabled, or API-blocked model is a{' '}
                <strong>404 naming the model</strong>, never a silent substitution.
              </p>
              <p style={{ ...p, marginBottom: 0 }}>
                <strong>Agents with memory: resolve once, pin after.</strong> Call{' '}
                <code style={mono}>xd/auto</code> when a character is created, read{' '}
                <code style={mono}>response.model</code>, pin that slug for the session — switching
                models mid-conversation throws away the prompt cache on a history that only grows.
              </p>
            </Section>

            <Section id="structured" title="Structured output">
              <p style={p}>
                Ask for a JSON schema and the reply either validates against it or the call fails
                with <code style={mono}>422</code> — never malformed text arriving at your validator
                as a surprise. One silent re-ask happens server-side first. The response's{' '}
                <code style={mono}>xd.structured_mode</code> reports the enforcement tier:{' '}
                <code style={mono}>native_schema</code> (constrained decoding),{' '}
                <code style={mono}>native_json</code> (JSON guaranteed, schema checked by us), or{' '}
                <code style={mono}>coaxed</code> (schema in the prompt, validated by us).
              </p>
              <Code label="a game agent's decision — this exact request runs against production" text={`{
  "model": "xd/cheap",
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
                Provider schema dialects differ (one rejects <code style={mono}>maximum</code>,
                another requires every property in <code style={mono}>required</code>) — ModelXD
                adapts the schema per provider and validates your <em>original</em> on the way back,
                so one schema means one thing even across a fallback chain. The decision arrives as a
                JSON <em>string</em> in <code style={mono}>choices[0].message.content</code>: parse
                it, don't regex it.
              </p>
            </Section>

            <Section id="images" title="Images">
              <Endpoint method="POST" path="/api/v1/images/generations" />
              <p style={p}>
                OpenAI-named so <code style={mono}>client.images.generate()</code> finds it — but{' '}
                <strong>async</strong>: the answer is a <code style={mono}>202</code> with a job id,
                not a finished file. Everything you can act on fails on <em>this</em> call — unknown
                model, empty prompt, exhausted balance, capped key — never as a job that dies later.
              </p>
              <Params rows={[
                ['prompt', 'string', true, 'What to generate.'],
                ['model', 'string', true, <>An image model slug, e.g. <code style={mono}>openai/gpt-image-2</code> — see <a href="#list-models" style={{ color: 'var(--red)' }}>?type=image</a>.</>],
                ['aspect_ratio', 'string', false, <>e.g. <code style={mono}>16:9</code>, <code style={mono}>1:1</code>, <code style={mono}>9:16</code>.</>],
                ['size', 'string', false, <>OpenAI's <code style={mono}>1024x1024</code> form, accepted as an alias so OpenAI SDKs work unchanged.</>],
                ['quality', 'string', false, <><code style={mono}>low</code> / <code style={mono}>medium</code> / <code style={mono}>high</code>.</>],
                ['n', 'integer', false, 'Number of images, up to 4.'],
              ]} />
              <Code text={`POST ${BASE}/api/v1/images/generations
{ "model": "openai/gpt-image-2", "prompt": "a cheerful farm girl, low-poly",
  "aspect_ratio": "16:9", "quality": "high" }

→ 202 { "id": "3f2b…", "object": "image.generation.job",
        "status": "running", "poll": "/api/v1/jobs/3f2b…" }`} />
            </Section>

            <Section id="videos" title="Videos">
              <Endpoint method="POST" path="/api/v1/videos/generations" />
              <p style={p}>Same shape as images; video runs take minutes, so poll every ~15s.</p>
              <Params rows={[
                ['prompt', 'string', true, 'What to generate.'],
                ['model', 'string', true, <>A video model slug — see <a href="#list-models" style={{ color: 'var(--red)' }}>?type=video</a>.</>],
                ['duration', 'integer', false, 'Seconds, 1–60, model-dependent range (commonly 4–15).'],
                ['aspect_ratio', 'string', false, <>e.g. <code style={mono}>16:9</code>, <code style={mono}>9:16</code>.</>],
                ['resolution', 'string', false, <>e.g. <code style={mono}>720p</code>, <code style={mono}>1080p</code> where the model offers tiers.</>],
              ]} />
            </Section>

            <Section id="jobs" title="Jobs">
              <Endpoint method="GET" path="/api/v1/jobs/{id}" />
              <Code text={`→ { "id": "3f2b…", "object": "image.generation.job",
    "status": "succeeded",            // running | succeeded | failed
    "model": "openai/gpt-image-2",
    "data": [ { "url": "https://…signed…" } ],
    "usage": { "cost_usd": 0.067 } }`} />
              <p style={{ ...p, marginTop: 12 }}>
                <strong>Fetch <code style={mono}>url</code> promptly</strong> — generated files sit
                behind signed URLs that expire in ~24 hours. Everything also lands in your XCreate
                gallery, which never expires. On <code style={mono}>failed</code>, the job carries an{' '}
                <code style={mono}>error</code> message and costs nothing beyond what the provider
                actually burned.
              </p>
              <Endpoint method="GET" path="/api/v1/jobs?type=image|video&limit=20" />
              <p style={{ ...p, marginBottom: 0 }}>
                Your recent generation jobs, newest first (limit ≤ 100). This is the recovery path:
                lose an id between the create and the first poll, and the job is still here — nothing
                has to be paid for twice. Files are not inlined; poll the one you want for a URL
                signed on the spot. Text runs are not listed — chat is synchronous and has no job.
              </p>
            </Section>

            <Section id="list-models" title="List models">
              <Endpoint method="GET" path="/api/v1/models?type=text|image|video" />
              <p style={p}>
                OpenAI-shaped (<code style={mono}>client.models.list()</code> works unchanged), and
                the only place a developer can discover ids like{' '}
                <code style={mono}>openai/gpt-image-2</code>. Every callable model is listed — text,
                image and video — each row carrying <code style={mono}>modalities</code>, an{' '}
                <code style={mono}>endpoint</code> naming where to send it, ModelXD's{' '}
                <code style={mono}>display_name</code>, <code style={mono}>pricing_usd_per_1m</code>{' '}
                (null for per-output-priced image/video models — honest, not missing), and{' '}
                <code style={mono}>capabilities</code>. The routers (<code style={mono}>xd/auto</code>,{' '}
                <code style={mono}>xd/cheap</code>) appear under text.
              </p>
              <Code text={`{ "object": "list", "data": [
  { "id": "openai/gpt-5.6-sol", "object": "model", "owned_by": "openai",
    "display_name": "GPT-5.6 Sol",
    "pricing_usd_per_1m": { "input": 5, "output": 30 },
    "capabilities": { "web_search": true, "structured_output": true, "vision": true } },
  { "id": "xd/auto", "object": "model", "owned_by": "modelxd", "tags": ["router"] }
] }`} />
            </Section>

            <Section id="errors" title="Errors">
              <p style={p}>
                OpenAI's envelope — <code style={mono}>{`{"error": {"message", "type", "code"}}`}</code>{' '}
                — so SDK error handling works unmodified. Retry <code style={mono}>429</code> /{' '}
                <code style={mono}>5xx</code> (429 carries <code style={mono}>Retry-After</code>);
                never retry other 4xx unchanged.
              </p>
              <Params rows={[
                ['401', 'auth', false, 'Missing or revoked key.'],
                ['400', 'request', false, <>Malformed request — including <code style={mono}>tools</code> (unsupported) and a bad <code style={mono}>response_format</code>.</>],
                ['402', 'billing', false, <><code style={mono}>insufficient_credits</code> (wallet empty) or <code style={mono}>spend_cap_reached</code> (this key's cap).</>],
                ['404', 'model', false, 'Unknown / disabled / blocked model, named in the message.'],
                ['422', 'schema', false, <><code style={mono}>schema_unsatisfied</code> — the model couldn't match your schema after the internal retry. Loosen the schema or try another model.</>],
                ['429 / 5xx', 'transient', false, <>Rate limited / provider failure — what <code style={mono}>models: [...]</code> fallback absorbs for you.</>],
              ]} />
            </Section>

            <Section id="billing" title="Billing & limits">
              <p style={p}>
                Calls debit your ModelXD wallet at the model's <strong>listed price</strong> — the
                same number <Link href="/xboard" style={{ color: 'var(--red)' }}>XBoard</Link> shows,
                no API markup, ever. Every response reports its real cost in{' '}
                <code style={mono}>usage.cost_usd</code>, streams included. Prompt caching on
                Anthropic-family models is applied automatically — keep your system message
                byte-stable and the saving shows up in the price, not in extra fields.
              </p>
              <p style={{ ...p, marginBottom: 0 }}>
                Ten agents thinking concurrently on one key is the designed load — nothing
                serializes, and the spend cap stays exact under parallel calls. There is no
                per-request rate limit today; the cap and your balance are the wall. New accounts
                start with $10 free credit; top-ups are 1:1 on{' '}
                <Link href="/profile" style={{ color: 'var(--red)' }}>Profile</Link>, where the
                activity ledger shows API usage per key.
              </p>
            </Section>

            <Section id="mcp" title="MCP — the same operations, for agent clients">
              <p style={p}>
                Writing a program? Use the REST endpoints above. Connecting an <em>agent</em> that
                picks its own tools — Claude Code, Cursor, n8n? That's MCP. Same key, same billing:
              </p>
              <Code text={`claude mcp add --transport http modelxd ${BASE}/api/mcp \\
  --header "Authorization: Bearer xd_..."`} />
              <Params rows={[
                ['get_leaderboard', 'tool', false, 'Models ranked by XD Score, with prices and provider/model_name ids.'],
                ['pick_model', 'tool', false, 'Vote-backed recommendation for an image / video generation.'],
                ['generate_image', 'tool', false, 'Bills listed price. Fast models return outputs inline; slower ones a job_id.'],
                ['generate_video', 'tool', false, 'Always returns a job_id immediately.'],
                ['check_job', 'tool', false, 'Poll ~15s until outputs and the actual cost land.'],
                ['get_balance', 'tool', false, "Wallet balance plus this key's spend and cap."],
              ]} />
              <p style={{ ...p, marginBottom: 0 }}>
                All outputs are AI-generated content — label them as such wherever they get
                published.
              </p>
            </Section>

            <p style={{ ...p, fontSize: 12.5, color: 'var(--muted2)' }}>
              Routing verbs and prices are live values, not promises — they move as votes land.
              Questions the docs don't answer: ask the agent on the{' '}
              <Link href="/" style={{ color: 'var(--red)' }}>home page</Link>.
            </p>
          </div>
      </div>

      {/* the rail folds away on narrow viewports — desktop-first, but no overlap */}
      <style>{`@media (max-width: 900px) { .docs-rail { display: none } }`}</style>
    </div>
  )
}
