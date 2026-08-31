# ModelXD API v1 — `/api/v1/chat/completions`

> Shipped 2026-08-27. Code: `app/api/v1/chat/completions/route.ts`,
> `lib/inference.ts`, `lib/json-schema.ts`, `lib/schema-adapt.ts`.
> Design rationale and the two games that specified it:
> https://claude.ai/code/artifact/535ef751-cf2a-418e-a52a-e60d9be2a7b4

The public inference API. OpenAI-shaped, so any existing SDK works by
changing one URL. **There is no ModelXD client library and there should
never be one** — needing one would mean the compatibility failed.

## Generating images and video

REST, so a game engine or any OpenAI SDK can call them without speaking
JSON-RPC. **Both are asynchronous**: you get a job id, not a finished file —
an image run takes seconds and video takes minutes, and a blocking REST call
dies at a proxy timeout. One polling loop serves images, video AND the Tripo
3D routes.

```http
POST /api/v1/images/generations
Authorization: Bearer <key>

{ "model": "openai/gpt-image-2", "prompt": "a cheerful farm girl, low-poly",
  "aspect_ratio": "16:9", "quality": "high" }
```

```json
202 { "id": "3f2b…", "object": "image.generation.job", "status": "running",
      "model": "openai/gpt-image-2", "poll": "/api/v1/jobs/3f2b…" }
```

`size: "1024x1024"` is accepted as an alias for `aspect_ratio`, so
`client.images.generate()` from an OpenAI SDK works unchanged.

Video is the same shape at `POST /api/v1/videos/generations`, taking
`duration` (seconds, model-dependent) and `resolution`.

```http
GET /api/v1/jobs/{id}
```

```json
{ "id": "3f2b…", "status": "succeeded",
  "data": [ { "url": "https://…signed…" } ],
  "usage": { "cost_usd": 0.067 } }
```

`status` is `running`, `succeeded` or `failed`. **Fetch `url` promptly** —
generated files sit behind signed URLs that expire in 24 hours.

Models come from `GET /api/v1/models`; anything with `image` or `video` in its
capabilities is valid here. Same key, same credits, same models as the studio
— and the same list price.

## Listing models

```http
GET /api/v1/models
Authorization: Bearer <your ModelXD API key>
```

OpenAI-shaped, so an OpenAI SDK's `client.models.list()` works unchanged:

```json
{ "object": "list", "data": [
  { "id": "xd/auto", "object": "model", "owned_by": "modelxd",
    "display_name": "ModelXD Auto (highest XD Score)", "tags": ["router"],
    "note": "Resolves to a catalog model per request; billed at that model's list price." },
  { "id": "openai/gpt-5.6-sol", "object": "model", "owned_by": "openai",
    "display_name": "GPT-5.6 Sol",
    "pricing_usd_per_1m": { "input": 5, "output": 30 },
    "capabilities": { "web_search": true, "structured_output": true, "vision": true },
    "tags": [] }
] }
```

The extra fields (`display_name`, `pricing_usd_per_1m`, `capabilities`, `tags`)
are ModelXD's; an OpenAI client ignores them.

The list is derived from the same rules `/v1/chat/completions` enforces —
enabled, text-capable, not blocked for the API — so **anything listed is
callable and anything callable is listed**. A discovery endpoint that
disagrees with the endpoint it describes is worse than none. Both routers
(`xd/auto`, `xd/cheap`) appear as ids, since a developer reading only this
endpoint would otherwise never learn they exist.

Currently 20 models + 2 routers; 15 support web search.

## The call

```bash
curl https://www.modelxd.com/api/v1/chat/completions \
  -H "Authorization: Bearer xd_…" \
  -H "Content-Type: application/json" \
  -d '{"model":"xd/cheap","messages":[{"role":"user","content":"hi"}]}'
```

```python
from openai import OpenAI
client = OpenAI(base_url="https://www.modelxd.com/api/v1", api_key="xd_…")
```

Keys are minted at `/xdev`. The three env vars a game server needs map
directly: `MODELXD_API_BASE_URL`, `MODELXD_API_KEY`, `MODELXD_MODEL`.

## Naming a model

| Form | Example | Meaning |
|---|---|---|
| Explicit | `google/gemini-3.6-flash` | Exactly that model. Canonical. |
| Legacy | `7c9f…` (uuid) | What MCP returns. Accepted indefinitely. |
| Routed | `xd/auto`, `xd/cheap` | We choose from the vote-based leaderboard. |

`xd/auto` = highest XD Score. `xd/cheap` = among models at or above the
median XD Score, the cheapest by list token price. Both apply a **10-vote
floor** so a model rated on a handful of votes cannot become the silent
default for every call a game makes.

The resolved model always comes back in `response.model`. An unknown,
disabled, wrong-modality, or API-blocked slug is a **404 naming the model** —
never a silent substitution.

**`xd/fast` does not exist yet.** It is implemented (`byMeasuredLatency` in
`lib/inference.ts`) but not exposed: `provider_calls` holds ~128 rows over
seven days and only one text-board model clears three samples, so the route
would have been silently identical to `xd/auto`. It turns on when there is
traffic to rank.

## Structured output — the reason this exists

`response_format: {"type":"json_schema","json_schema":{"name":…,"schema":…}}`

Three tiers, reported back as `xd.structured_mode`:

| Tier | Providers | Guarantee |
|---|---|---|
| `native_schema` | openai, google, anthropic, xai | Constrained decoding. |
| `native_json` | alibaba, moonshot | Valid JSON; schema checked by us. |
| `coaxed` | anything else | Schema in the prompt, tolerant parse. |

**Every tier is validated server-side against the caller's original schema**
(`lib/json-schema.ts`), with one silent re-ask on a miss and a `422` after
that. A schema violation is therefore always a status code, never malformed
text arriving at the game's validator as a surprise.

### Provider schema dialects

"native_schema" is not one thing, and the differences are hard 400s.
Anthropic rejects `maximum` on an integer; OpenAI's strict mode requires
every property to be `required`; Gemini rejects `additionalProperties`.

`lib/schema-adapt.ts` strips what each provider cannot take, folds the
removed constraint into the field's `description` so the model still reads
the rule, and lets our validator enforce the original. Without this, a
caller's schema would mean different things depending on which model the
router picked — and `models: […]` fallback would change validation
mid-chain. The official Anthropic SDKs do the same transform; `anthropic.ts`
talks raw HTTP, so we do it ourselves.

## Reliability

- **`models: ["a","b","c"]`** — ordered fallback chain, first that answers
  wins. `xd.fallbacks` reports what was skipped and why.
- **Streaming** (`stream: true`) — standard SSE. The final chunk carries
  `usage`, so a streaming caller never makes a second request to learn the
  cost. A **schema'd request buffers**: you cannot un-send a stream, and
  re-asking on an invalid object is the point of a schema.
- **Errors** use OpenAI's envelope (`{error:{message,type,code}}`) so SDK
  error handling works unmodified. 429 carries `Retry-After`.
- **Spend cap** — each call reserves `CAP_RESERVE_USD` against the key
  atomically (migration 88) and trues up to the real cost. Ten concurrent
  agents cannot all pass an unspent cap.

## Deliberate omissions

- **Tool calling** → explicit `400`. Accepting `tools` and returning prose
  would leave the caller debugging a model that "ignores" its functions.
  Use `response_format`; both reference games want a filled-in form, not a
  function call.
- **CORS** — no headers, no `OPTIONS`. A key that cannot be used from a
  browser cannot be stolen from one.
- **Image / video** — job-shaped, not chat-shaped. They stay on `/api/mcp`.
- **Margin on inference** — never. Calls bill list price; XBoard publishes
  those prices and billing over them would make the leaderboard a lie. The
  margin is the provider-side discount ModelXD receives (owner, Aug 27) —
  users pay list, we pay less, nothing to build.

## The shared core

`lib/inference.ts` has two consumers: this route, and XTalk Werewolf's
`askModel` **in process**. Werewolf was deliberately not pointed at the
public endpoint — that would be the same lambda calling itself over the
network, the exact smell in `/api/mcp`.

The core does not take Werewolf's policy away. Retry rules, the 90s ceiling,
and the field-extraction safety boundary stay in the game. Two options exist
for that:

- **`bill: false`** — Werewolf debits once per *act*, which is what keeps a
  whole game as one expandable row in the Profile ledger instead of sixty.
- **`onUsage`** — fires even for an attempt that then fails or comes back
  empty, because those tokens were burned upstream regardless.

## Verified 2026-08-27

Live, against a capped throwaway key (total spend $0.0157):

- Gauntlet's decision schema returned valid on `anthropic/claude-sonnet-5`,
  `google/gemini-3.6-flash`, `openai/gpt-5.5` (native_schema) and
  `moonshot/kimi-k3` (native_json).
- Streaming with a system prompt, usage + `cost_usd` in the final chunk.
- Fallback chain recovering from a bad model name.
- `xd/cheap` resolving 10× cheaper than `xd/auto` ($0.00056 vs $0.0056).
- 401 / tools-400 / unknown-model-404 / bad-response_format-400.
- 18/18 unit cases on the validator and JSON extractor.

**Werewolf verified same day:** a full cycle played through the migrated
`askModel` — 3 night acts, 6 day speeches across 5 providers, a 3–3 tied
vote correctly resolved, Night 2 self-starting. $0.18, per-act costs on
every card, no reasoning leaks.
