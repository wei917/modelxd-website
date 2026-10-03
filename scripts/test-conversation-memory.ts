// scripts/test-conversation-memory.ts — the shared part of long
// conversations (lib/conversation-memory.ts, Oct 3): each model's limit and
// price jump from its catalog row, the summary point, the budget, what a
// reply read, and the summarize step with storage passed in. No network, no
// database.
//   npx tsx scripts/test-conversation-memory.ts

import fs from 'node:fs'
import path from 'node:path'
import * as cm from '../lib/conversation-memory'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }

// Catalog rows as the models session filled them (Oct 3), plus the price
// tiers in the shape it agreed (model_pricing.long_context).
const claude = { context_window: 1_000_000, model_pricing: { tokens: { text_input: 4 } } }
const gpt6 = { context_window: 922_000, model_pricing: { tokens: { text_input: 2 } } }
const gpt6Tier = { context_window: 922_000, model_pricing: { tokens: { text_input: 2 }, long_context: { threshold_input_tokens: 272_000, tokens: { text_input: 4 } } } }
const grokTier = { context_window: 500_000, model_pricing: { long_context: { threshold_input_tokens: 200_000, tokens: {} } } }
const lateJump = { context_window: 200_000, model_pricing: { long_context: { threshold_input_tokens: 300_000 } } }
const unknown = { context_window: null }

// ── Limits ─────────────────────────────────────────────────────────────────
check('limit: the catalog\'s, else 100k', cm.windowOf(claude) === 1_000_000 && cm.windowOf(unknown) === 100_000 && cm.windowOf({ context_window: 0 }) === 100_000 && cm.windowOf(null) === 100_000)
check('price jump: from the pricing data, else none', cm.priceJumpOf(gpt6Tier) === 272_000 && cm.priceJumpOf(gpt6) === null && cm.priceJumpOf({ model_pricing: { long_context: { threshold_input_tokens: 0 } } }) === null)
check('most one request should carry: the limit, or the price jump if it comes first', cm.maxInputOf(gpt6Tier) === 272_000 && cm.maxInputOf(claude) === 1_000_000 && cm.maxInputOf(lateJump) === 200_000)

// ── When to summarize ──────────────────────────────────────────────────────
check('summary point: 70% of each model\'s own limit', cm.summaryPointOf(claude) === 700_000 && cm.summaryPointOf(gpt6) === 645_400 && cm.summaryPointOf(unknown) === 70_000)
check('summary point: just before a price jump that comes first (GPT-6 at 272k, Grok at 200k)', cm.summaryPointOf(gpt6Tier) === 244_800 && cm.summaryPointOf(grokTier) === 180_000)
check('summary point: a jump past 70% changes nothing', cm.summaryPointOf(lateJump) === 140_000)
check('kept word for word: 40% of the limit, in proportion when the jump sets the point', cm.keepRawOf(claude) === 400_000 && cm.keepRawOf(gpt6Tier) === Math.floor(244_800 * 0.4 / 0.7))

// ── Budget ─────────────────────────────────────────────────────────────────
check('raw budget: 90% of the limit less the instructions and room for the reply', cm.rawBudget({ context_window: 100_000 }, 10_000) === 72_000 && cm.rawBudget({ context_window: 10_000 }, 20_000) === 4_000)
check('raw budget: never past a price jump', cm.rawBudget(gpt6Tier, 10_000) === 272_000 - 10_000 - 8_000)
check('tokens, roughly: a Chinese, Japanese or Korean character about one, Latin about a quarter', cm.approxTokens('天地人') === 3 && cm.approxTokens('abcd') === 1 && cm.approxTokens('こんにちは') === 5 && cm.approxTokens('안녕') === 2)
const long = Array.from({ length: 300 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `${i}:` + '字'.repeat(1000) }))
const fit = cm.fitBudget(long, 50_000)
check('fit: the newest messages that fit, in order; the oldest left out', fit.kept.at(-1)!.content.startsWith('299:') && fit.kept[0].content.startsWith(`${fit.dropped}:`) && fit.dropped + fit.kept.length === 300 && fit.kept.length < 51)
check('fit: the latest message is kept even when it alone is too big', cm.fitBudget([{ role: 'user', content: '字'.repeat(200) }], 50).kept.length === 1)
check('what a reply read: the provider\'s input count, cache hits inside it, never added twice', cm.tokensRead({ inputTokens: 5000, cachedTokens: 4000 }) === 5000 && cm.tokensRead({ inputTokens: 72_000, cachedTokens: 70_000 }) === 72_000 && cm.tokensRead({}) === null && cm.tokensRead({ inputTokens: 0 }) === null)
check('numbers as people read them', [800, 27_613, 922_000, 991_000, 1_000_000, 1_048_576].map(cm.formatTokens).join(' ') === '800 28k 922k 991k 1M 1.05M')

// ── The summarize step, storage passed in ──────────────────────────────────
async function summarizeChecks() {
  const thread = Array.from({ length: 10 }, (_, i) => ({ seq: (i + 1) * 10, role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `${i}` + '字'.repeat(999) }))
  const small = { context_window: 10_000 }        // point 7,000, keep 4,000
  let loads = 0, runs = 0, charged = 0
  // Set inside the callbacks below.
  let seen: any = null, savedRow: any = null
  const base = (over: Partial<Parameters<typeof cm.maybeSummarize>[0]> = {}) => cm.maybeSummarize({
    model: small, inputTokens: 8_000,
    load: async () => { loads++; return { summary: { text: '舊的', through_seq: 0 }, thread } },
    prompt: ({ oldSummary, fold }) => ({ system: 'SUM', content: `${oldSummary}|${fold.map(m => m.seq).join(',')}` }),
    run: async (system, content) => { runs++; seen = { system, content }; return { text: ' 新的摘要 ', inputTokens: 6_000, outputTokens: 300, cost: 0.004 } },
    save: async (s) => { savedRow = s; return 'saved' },
    charge: async (usd) => { charged += usd },
    ...over,
  })
  const r0 = await base({ inputTokens: 7_000 })
  check('at or under the summary point: nothing loaded, no call, no charge', !r0.saved && r0.reason === 'under the threshold' && loads === 0 && runs === 0)
  const r1 = await base()
  check('past it: the older part is summarized with the previous summary; the newest 40% stays word for word', r1.saved && r1.through_seq === 60 && seen.content === '舊的|10,20,30,40,50,60', `${seen?.content}`)
  check('saved trimmed, with its tokens and cost; the cost is charged', savedRow.text === '新的摘要' && savedRow.through_seq === 60 && savedRow.outputTokens === 300 && charged === 0.004)
  const r2 = await base({ load: async () => null })
  check('no storage (e.g. before its migration): no summary, no error', !r2.saved && r2.reason === 'messages table missing')
  const r3 = await base({ load: async () => ({ summary: null, thread: thread.slice(-3) }) })
  check('everything already fits the kept share: nothing to fold, no call', !r3.saved && r3.reason === 'nothing old enough to fold')
  const before = charged
  const r4 = await base({ run: async () => ({ text: '  ', inputTokens: 1, outputTokens: 0, cost: 0.001 }) })
  check('the model wrote nothing: nothing saved, no charge', !r4.saved && r4.reason === 'the model wrote nothing' && charged === before)
  const r5 = await base({ save: async () => 'duplicate' })
  check('already summarized to that point (two replies at once): no second charge', !r5.saved && r5.reason === 'already summarized to that point' && charged === before)
  const r6 = await base({ save: async () => 'permission denied' })
  check('a save error is reported, not thrown, and not charged', !r6.saved && r6.reason === 'save failed: permission denied' && charged === before)
  const r7 = await base({ load: async () => { throw new Error('boom') } })
  check('anything that throws is caught', !r7.saved && r7.reason === 'failed: boom')
  const r8 = await base({ model: gpt6Tier, inputTokens: 250_000 }), r9 = await base({ model: gpt6, inputTokens: 250_000 })
  check('a price jump moves the point: GPT-6 at 250k goes on to summarize with the tier, not without it (70% = 645,400)', r8.reason === 'nothing old enough to fold' && r9.reason === 'under the threshold', `${r8.reason} / ${r9.reason}`)

  const n1 = await base({ now: true, inputTokens: null })
  check('now (a press): no summary point; the whole conversation so far goes into the summary', n1.saved && n1.through_seq === 100 && n1.text === '新的摘要' && seen.content === '舊的|10,20,30,40,50,60,70,80,90,100', `${seen?.content}`)
  const n2 = await base({ now: true, load: async () => ({ summary: null, thread: thread.slice(-2) }) })
  check('now, with a single exchange: that exchange is summarized', n2.saved && n2.through_seq === 100)
  const n3 = await base({ now: true, load: async () => ({ summary: { text: '舊的', through_seq: 100 }, thread: [] }) })
  check('now, with nothing since the last summary: nothing to fold', !n3.saved && n3.reason === 'nothing old enough to fold')
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'conversation-memory.ts'), 'utf8')
  check('the shared module is pure: no imports, so the page and every route can use it', !/^import /m.test(src))
  const meter = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'ContextMeter.tsx'), 'utf8')
  check('the meter shows current / max and marks the summary point', /formatTokens\(used\)\} \/ \{formatTokens\(max\)\}/.test(meter) && /point \/ max \* 100/.test(meter))
}

summarizeChecks().then(() => { console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0) })
