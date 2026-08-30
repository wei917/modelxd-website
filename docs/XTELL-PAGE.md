# XTELL-PAGE.md — X算命 (`/xtell`)

> Everything about the XTell surface. Written 2026-08-30, verified against the
> code the same day. Read this before touching `app/xtell/*`, `lib/xtell.ts`,
> `lib/classics.ts`, or `app/api/xtell/*`.

## What it is

Fortune telling as an application surface, aimed at the Taiwan/Japan market.
**Entertainment, clearly labeled (僅供娛樂), and kept far from anything
measured** — it must never share a byline with XEval's benchmark claims.

The design metaphor is the owner's: **each template is a Temple (廟)**. You
don't open a chat about love — you visit 月老廟. The street page lists the
temples; each temple is one divination method with its own ink-wash cover
(house art language: painterly, no robots, no AI-slop).

## The architecture rule (the one thing you must not break)

**The model never computes the chart. Code computes the chart; the model only
interprets it.**

```
user birth input → server library computes the chart (deterministic, checkable)
                 → chart facts serialized into the MASTER's system prompt
                 → user chats; every turn carries the facts natively
                 → model writes the reading, billed at list price
```

Why: a model recalls 干支 calendar rules impressively well (all four frontier
models passed the 立春 trap unaided — tested Aug 29) but "usually right" is
the worst place to be, because a wrong 排盤 is instantly checkable against
any Taiwanese 排盤 site and torches credibility. A library is right every
time for free. The models' job is the part with no right answer: the reading.

## Temples (3 live)

| temple | method | engine | notes |
|---|---|---|---|
| 八字廟 | BaZi four pillars | `lunar-typescript` (MIT, zero deps) | 節氣-exact: year pillar turns at the 立春 INSTANT (20:40:24-level precision), 五虎遁/五鼠遁, 藏干, 十神, 納音, 大運 via `getYun(gender)` |
| 紫微斗數廟 | Zi Wei Dou Shu | `iztro` (MIT) | 12 palaces, major/minor/adjective stars, brightness + 四化 (mutagen), 五行局, 命主/身主. Needs an exact hour — 命宮 cannot be placed without one |
| 月老廟 | 合婚 (two people) | `lunar-typescript` ×2 | Two birth rows (第一位/第二位, each with own gender — defaults M+F, fully editable). Both charts ride the system slot; 查看命盤 stacks two boards |

## The room flow (owner's design, Aug 30: "hide as much as possible")

1. Birth date + time + gender → **進廟**. The chart is computed at that moment
   (free) so bad dates fail before any chat. The chart is NOT shown.
2. Chat, XDirect's composer exactly (Enter sends, Shift+Enter breaks).
   **Master chips** above: up to 2 models, default preselected
   (`DEFAULT_MASTER = 'gpt-5.6-sol'` in `app/xtell/client.tsx` — one constant
   to move when the catalog does; falls back to newest enabled text model).
   Every seated master answers every question; each keeps its own private
   thread (its replies only) so two masters never contaminate each other.
   Each reply shows model + actual cost. Two masters = 合參/second opinion —
   the ModelXD thesis in temple robes.
3. `查看命盤` (dotted link) expands the full board for verification, with the
   **engine provenance line** (`排盤引擎: lunar-typescript v1.8.6`).
4. Web search: one toggle, double-gated — applied per master only where that
   model declares `web_search` in `output_config.text.capabilities`.

No auto-send anywhere: an intro line is static text; nothing spends until the
user types (same rule as XDirect's `?q=`).

## Files

```
app/xtell/page.tsx          # server shell (title/meta)
app/xtell/client.tsx        # street + TempleRoom chat + BirthRow + boards
app/api/xtell/chart/route.ts    # POST {temple, birth[, birth2]} → chart + engine. Free, auth required.
app/api/xtell/reading/route.ts  # POST {temple, birth[, birth2], question, modelId, history, search}
                                #   → SSE stream; bills list price at settle (XCreate chat pattern)
lib/xtell.ts                # charts, facts serializers, ENGINES, MASTERS, validBirth
lib/classics.ts             # 古籍 retrieval (see below)
content/classics/*.txt      # 《滴天髓》42 chapters + 《紫微斗數全書·卷一》 (Wikisource, public domain)
scripts/xtell-golden.ts     # golden-chart suite — npm run test:xtell
public/xtell/*.jpg          # temple covers (ink-wash, gpt-image-2)
```

## Masters (system prompts in `lib/xtell.ts` MASTERS)

Per-temple personas (廟裡的老師; 月老 himself in 月老廟). Shared guardrails:

- Only the provided chart — never recompute or alter a pillar.
- **Tendency tone** (learned from Wolke/ziwei-doushu's ETHICS.md): 傾向/容易/
  偏向/宜留意 — never 一定/注定/必然. Encoded as the shared `TONE` constant.
- 月老 extra: never declares a relationship doomed (clash-heavy pairings get
  what-to-tend framing); refuses third-party snooping; safety issues →
  serious referral to real resources, out of persona.
- No medical/financial/legal directives. Ends with 僅供參考與娛樂.
- 繁體中文 unless the visitor writes otherwise.

## Classics grounding (`lib/classics.ts`)

Idea from Sudo-Biao/Chinese-Metaphysics-Platform (MIT): a 批文 that quotes
《滴天髓》 reads like a master; free prose reads like a chatbot.

- Corpus: public-domain texts fetched from zh.wikisource.org, cleaned of wiki
  markup, split into ≤420-char quotable passages. 八字/月老 → 滴天髓;
  紫微 → 紫微全書卷一.
- Retrieval: CJK-bigram overlap (no tokenizer needed), scored against the
  question PLUS the chart facts — so a questionless full reading still
  retrieves on the actual 日主's vocabulary. Top 3 passages.
- Injected into the system slot as OPTIONAL citable material: quote by book
  title when relevant, ignore otherwise, **never fabricate a classic** —
  everything quotable exists on disk and is checkable.

## 時辰不確定 (unknown birth hour)

Common in TW. Checkbox per birth row (hidden in 紫微廟ompute — 命宮 needs an
hour). Chart computed at noon internally but `baziFacts(..., hourUnknown)`
serializes THREE pillars only, marks 大運 start-ages approximate, and orders
the master to disclose the limit and keep 時柱-domain claims (晚年/子女/內心
底色) soft. Idea from vedic-astro-skills' rectifier; a future rectifier
temple (deduce the hour from life events) is on the backlog.

## Golden charts (`npm run test:xtell`)

Frozen OBSERVED outputs (never hand-recalled — the first version froze two
remembered values and both were wrong; the suite caught its own author):

- 1990-01-01 15:25 → 己巳 丙子 丙寅 丙申 (pre-立春 trap; model-verified 4/4)
- 1985-07-20 09:00 → 乙丑 癸未 庚申 辛巳 (model-verified)
- 2000-02-04 **12:00 vs 21:30** — same calendar day straddling the 20:40:24
  立春 instant: 己卯/丁丑 vs 庚辰/戊寅, day pillar 壬辰 unchanged
- 1988-06-15 23:30 晚子時 → 戊辰 戊午 辛丑 庚子 (day pillar stays, 子時 stem
  from the NEXT day's stem — 日不變、時遁次日干 school; frozen so a library
  upgrade silently switching schools fails loudly)
- 紫微 1990-01-01 申時 → 命宮己巳 巨門[旺], 木三局, 命主武曲/身主天機

Run it before shipping ANY dependency bump that touches lunar-typescript or
iztro.

## Studied repos (owner-shared, Aug 30 — learn, credit, respect licenses)

| repo | took | license line |
|---|---|---|
| Wolke/ziwei-doushu | tendency-tone ethics rule | CC BY-NC-SA — **learn only** |
| CNWU16/vedic-astro-skills | hourUnknown; (backlog: rectifier) | AGPL + commercial restrictions — **never copy** |
| Horace-Maxwell/horosa-skill | provenance line; golden-fact tests; 合參-flags-contradictions framing | AGPL — **learn only** |
| Sudo-Biao/Chinese-Metaphysics-Platform | classics KB + retrieval; independent confirmation of pillar algorithms | MIT — portable with attribution |

## Backlog (owner picks)

- 籤詩亭 (求籤 + 擲筊 ritual; poems are fixed public-domain texts) — was
  phase 1 of the original temple-street design, deferred by the chat redesign
- Birth-time rectifier temple; 六爻亭 (interactive coin ritual); 擇日
- 真太陽時 toggle (Taipei ≈ +6 min vs UTC+8 meridian)
- Persistence (saved charts, 流年 refresh) — currently nothing is stored
- Share cards for 批文; XDev MCP exposure of chart tools
- More classics (淵海子平, 三命通會) as corpus grows
