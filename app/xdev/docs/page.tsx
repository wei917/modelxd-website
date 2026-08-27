// app/xdev/docs/page.tsx — the public API reference.
//
// PUBLIC on purpose: docs are read before the decision to sign up, so
// gating them behind auth would gate the pitch. Server component, no
// client JS — a reference page has nothing to hydrate.
//
// One rule for the content: every snippet on this page was run against the
// live endpoint before being written down (see docs/API-V1.md for the
// verification log). If the API changes, this page changes in the same
// commit — a stale example here becomes a developer's wasted hour.

import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'API Docs — build on the models that win | ModelXD',
  description:
    'The ModelXD API: OpenAI-compatible chat completions with vote-based routing (xd/auto, xd/cheap), enforced JSON schema output, and MCP tools for image and video generation.',
}

const BASE = 'https://www.modelxd.com'

// ── tiny presentational helpers (server-side, no state) ──────────────────

function Code({ children }: { children: string }) {
  return (
    <pre style={{
      margin: '10px 0 0', padding: '13px 15px', borderRadius: 10,
      border: '1px solid var(--border2)', background: 'var(--bg)',
      fontSize: 12, fontFamily: 'var(--font-mono), monospace',
      overflowX: 'auto', lineHeight: 1.6, whiteSpace: 'pre',
    }}>{children}</pre>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <tr>
      <td style={{ padding: '7px 16px 7px 0', fontFamily: 'var(--font-mono), monospace', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
      <td style={{ padding: '7px 0', color: 'var(--muted)', fontSize: 12.5 }}>{v}</td>
    </tr>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{
      border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface)',
      padding: '20px 22px', marginBottom: 18,
    }}>
      <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 10px' }}>{title}</h2>
      {children}
    </section>
  )
}

const p: React.CSSProperties = { color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.65, margin: '0 0 10px' }
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono), monospace', fontSize: '0.92em' }
const eyebrow: React.CSSProperties = {
  fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.09em',
  textTransform: 'uppercase', color: 'var(--muted)',
}

export default function ApiDocsPage() {
  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena" style={{ maxWidth: 860 }}>
        <span className="prompt-label eyebrow">XDEV · API REFERENCE</span>
        <h1 className="page-headline" style={{ marginBottom: 8 }}>Build on the models that win.</h1>
        <p style={{ ...p, maxWidth: 640, marginBottom: 8 }}>
          One key, two surfaces. An <strong>OpenAI-compatible text API</strong> — swap the base URL,
          keep your SDK — and an <strong>MCP server</strong> for image and video generation from
          agents. Both bill your ModelXD wallet at the listed prices, and both can route on the one
          signal nobody else has: blind human votes.
        </p>
        <p style={{ ...p, marginBottom: 26 }}>
          Keys are minted on <Link href="/xdev" style={{ color: 'var(--red)' }}>XDev</Link> · prices
          live on <Link href="/xboard" style={{ color: 'var(--red)' }}>XBoard</Link> · this page is
          the whole contract.
        </p>

        <Section id="auth" title="Authentication">
          <p style={p}>
            Every request carries a key from <Link href="/xdev" style={{ color: 'var(--red)' }}>/xdev</Link> as
            a bearer token. Keys are shown once, stored hashed, and can carry a lifetime spend cap —
            the cap is enforced <em>before</em> a call spends, atomically, so ten concurrent requests
            cannot slip past it together.
          </p>
          <Code>{`Authorization: Bearer xd_...`}</Code>
          <p style={{ ...p, marginTop: 10, marginBottom: 0 }}>
            <strong>Server-side only.</strong> The API sends no CORS headers, so a browser cannot call
            it — which means a key shipped in a game client cannot be stolen from one. Keep the key on
            your game server; the engine talks to your server, your server talks to ModelXD.
          </p>
        </Section>

        <Section id="chat" title="Text — POST /api/v1/chat/completions">
          <p style={p}>
            The OpenAI chat-completions shape. Any OpenAI SDK works by changing the base URL; errors
            come back in the same envelope your SDK already handles.
          </p>
          <Code>{`from openai import OpenAI
client = OpenAI(base_url="${BASE}/api/v1", api_key="xd_...")

r = client.chat.completions.create(
    model="xd/auto",
    messages=[{"role": "system", "content": "You are a terse scout."},
              {"role": "user", "content": "Report on the north field."}],
)
print(r.choices[0].message.content)
print(r.model)              # the model that actually answered
print(r.usage)              # includes cost_usd — the real price of this call`}</Code>
          <div style={{ ...eyebrow, marginTop: 16 }}>request fields</div>
          <table style={{ borderCollapse: 'collapse', marginTop: 4 }}><tbody>
            <Row k="model" v={<>A model slug, or a routing verb — see <a href="#models" style={{ color: 'var(--red)' }}>Naming a model</a>. Required (or <code style={mono}>models</code>).</>} />
            <Row k="models" v={<>Ordered fallback array: <code style={mono}>{`["xai/grok-4.6", "xd/cheap"]`}</code>. The first model that answers wins; a 429 or provider failure moves to the next. The response's <code style={mono}>xd.fallbacks</code> lists what was skipped and why.</>} />
            <Row k="messages" v={<><code style={mono}>system</code> / <code style={mono}>user</code> / <code style={mono}>assistant</code>. System messages ride each provider's native system slot (and its prompt cache), never the message array.</>} />
            <Row k="stream" v={<>Standard SSE chunks. The final chunk carries <code style={mono}>usage</code> including <code style={mono}>cost_usd</code>, so you never make a second request to learn the price.</>} />
            <Row k="response_format" v={<>OpenAI's field. <code style={mono}>json_schema</code> is enforced server-side — see <a href="#structured" style={{ color: 'var(--red)' }}>Structured output</a>.</>} />
            <Row k="max_tokens" v="Output cap. Optional; a sane default per model otherwise." />
            <Row k="xd" v={<>ModelXD extras, ignored by standard clients: <code style={mono}>{`{"effort": "low" | ... | "max", "search": true}`}</code>. Effort maps to each provider's thinking level; search enables web search on models that support it (billed per search on top of tokens).</>} />
          </tbody></table>
          <p style={{ ...p, marginTop: 12, marginBottom: 0 }}>
            <strong>Not supported, loudly:</strong> <code style={mono}>tools</code> / function calling
            returns an explicit 400 rather than prose that ignores your functions. For agent
            decisions, use <code style={mono}>response_format</code> — a filled-in form beats a
            function call, and it is what the schema path is for.
          </p>
        </Section>

        <Section id="models" title="Naming a model">
          <table style={{ borderCollapse: 'collapse' }}><tbody>
            <Row k="provider/model_name" v={<>Exactly that model — e.g. <code style={mono}>google/gemini-3.6-flash</code>, <code style={mono}>anthropic/claude-sonnet-5</code>. The slugs come from <Link href="/xboard" style={{ color: 'var(--red)' }}>XBoard</Link> or the MCP <code style={mono}>get_leaderboard</code> tool.</>} />
            <Row k="xd/auto" v="ModelXD picks the highest XD Score on the text board — the model real blind votes say is best right now." />
            <Row k="xd/cheap" v="Among models at or above the board's median score, the cheapest by list token price. Routinely ~10× cheaper than xd/auto; built for NPC crowds." />
          </tbody></table>
          <p style={{ ...p, marginTop: 12 }}>
            The resolved model always comes back in <code style={mono}>response.model</code> — you are
            never routed blind. An unknown, disabled, or API-blocked model is a <strong>404 naming the
            model</strong>, never a silent substitution.
          </p>
          <p style={{ ...p, marginBottom: 0 }}>
            <strong>For agents with memory:</strong> resolve once, pin after. Call{' '}
            <code style={mono}>xd/auto</code> when a character is created, read{' '}
            <code style={mono}>response.model</code>, and pin that slug for the session — a model
            switch mid-conversation throws away the prompt cache on a history that only grows.
          </p>
        </Section>

        <Section id="structured" title="Structured output — decisions a game can trust">
          <p style={p}>
            Ask for a schema and the reply either validates against it or you get a{' '}
            <code style={mono}>422</code> — never malformed text arriving at your validator as a
            surprise. One silent re-ask happens server-side first. A schema'd request buffers instead
            of streaming (you cannot un-send a stream), and providers that cannot enforce a schema
            natively get it in the prompt with our validation behind them — the response's{' '}
            <code style={mono}>xd.structured_mode</code> says which tier ran
            (<code style={mono}>native_schema</code> / <code style={mono}>native_json</code> /{' '}
            <code style={mono}>coaxed</code>).
          </p>
          <Code>{`{
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
        "action":   {"enum": ["plant","water","harvest","store","move_to",
                              "steal","guard","chase","flee","idle"]},
        "target":   {"type": "string"},
        "amount":   {"type": "integer", "maximum": 10},
        "reason":   {"type": "string"}
      },
      "required": ["action", "reason"],
      "additionalProperties": false
    }
  }},
  "xd": {"effort": "low"}
}`}</Code>
          <p style={{ ...p, marginTop: 10, marginBottom: 0 }}>
            Provider schema dialects differ (one rejects <code style={mono}>maximum</code>, another
            requires every property in <code style={mono}>required</code>) — ModelXD adapts the schema
            per provider and validates your <em>original</em> on the way back, so one schema means one
            thing even across a fallback chain.
          </p>
        </Section>

        <Section id="errors" title="Errors">
          <p style={p}>OpenAI's envelope: <code style={mono}>{`{"error": {"message", "type", "code"}}`}</code>. Retry on 429/5xx (429 carries <code style={mono}>Retry-After</code>); never retry 4xx.</p>
          <table style={{ borderCollapse: 'collapse' }}><tbody>
            <Row k="401" v="Missing or revoked key." />
            <Row k="400" v="Bad request — including tools (unsupported) and malformed response_format." />
            <Row k="402" v={<><code style={mono}>insufficient_credits</code> (wallet empty) or <code style={mono}>spend_cap_reached</code> (this key's cap).</>} />
            <Row k="404" v="Unknown / disabled / blocked model, named in the message." />
            <Row k="422" v={<><code style={mono}>schema_unsatisfied</code> — the model couldn't match your schema after a retry. Loosen the schema or try another model.</>} />
            <Row k="429 / 5xx" v={<>Rate limited / provider failure. This is what <code style={mono}>models: [...]</code> fallback absorbs for you.</>} />
          </tbody></table>
        </Section>

        <Section id="billing" title="Billing">
          <p style={p}>
            Calls debit your ModelXD wallet at the model's <strong>listed price</strong> — the same
            number XBoard shows, with no API markup, ever. Every response reports what it cost in{' '}
            <code style={mono}>usage.cost_usd</code>. Anthropic-family prompt caching is applied
            automatically (your stable system prompt and conversation head are cached and re-served
            at the provider's discounted rate — you'll see it in the price, not in extra fields).
            Per-key spend caps and per-key spend live on <Link href="/xdev" style={{ color: 'var(--red)' }}>/xdev</Link>;
            activity appears in your <Link href="/profile" style={{ color: 'var(--red)' }}>Profile</Link> ledger.
          </p>
          <p style={{ ...p, marginBottom: 0 }}>
            Ten agents thinking concurrently on one key is the designed load — nothing serializes,
            and the cap stays exact under parallel calls.
          </p>
        </Section>

        <Section id="mcp" title="Images & video — the MCP server">
          <p style={p}>
            Generation is job-shaped (minutes, progress, polling), so it lives on MCP rather than
            chat completions. Same key, endpoint <code style={mono}>{BASE}/api/mcp</code>:
          </p>
          <Code>{`claude mcp add --transport http modelxd ${BASE}/api/mcp \\
  --header "Authorization: Bearer xd_..."`}</Code>
          <table style={{ borderCollapse: 'collapse', marginTop: 14 }}><tbody>
            <Row k="get_leaderboard" v="Models ranked by XD Score, with prices and provider/model_name ids." />
            <Row k="pick_model" v="Vote-backed recommendation for an image / video generation." />
            <Row k="generate_image" v="Bills listed price. Fast models return outputs inline; slower ones a job_id." />
            <Row k="generate_video" v="Always returns a job_id immediately." />
            <Row k="check_job" v="Poll ~15s until outputs and the actual cost land." />
            <Row k="get_balance" v="Wallet balance plus this key's spend and cap." />
          </tbody></table>
          <p style={{ ...p, marginTop: 12, marginBottom: 0 }}>
            <strong>Output URLs are signed and expire in ~24 hours</strong> — download on receipt and
            store the file yourself. Everything generated also lands in your XCreate gallery, where
            it never expires. All outputs are AI-generated content: label them as such wherever they
            get published.
          </p>
        </Section>

        <p style={{ ...p, fontSize: 12.5, color: 'var(--muted2)' }}>
          The routing verbs and prices on this page are live values, not promises — they move as
          votes land. Questions the docs don't answer: ask the agent on the{' '}
          <Link href="/" style={{ color: 'var(--red)' }}>home page</Link>.
        </p>
      </div>
    </div>
  )
}
