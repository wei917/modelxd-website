// scripts/test-trending-job.ts — the weekly job's spend accounting, offline.
//
//   npx tsx scripts/test-trending-job.ts
//
// fetch is mocked (the xAI stream, the call-log edge function, Supabase REST),
// so nothing is spent or written. A search whose response reports no cost is
// logged as null, never $0 (Codex review, Sep 27); an answer that isn't JSON
// still logs exactly one end row; the month's spend counts null or unreadable
// costs and unfinished calls at SEARCH_EST_USD.

import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://job-test.invalid'
process.env.SUPABASE_SECRET_KEY = 'test-only'
process.env.XAI_API_KEY = 'test-only'

type Logged = { action: string; request_id: string; status?: string; cost_usd?: number | null; usage_metadata?: any }
const logged: Logged[] = []
let xaiResponse: any = null
let xaiCalls = 0
let xaiBody = ''
let costRows: any[] = []
let callRows: any[] = []
let spendReadable = true
const CATALOG = [
  { provider: 'runway', model_name: 'seedance2_5', display_name: 'Seedance 2.5', output_modalities: ['video'], modes: ['text_to_video'], blocked_features: [], enabled: true },
  { provider: 'openai', model_name: 'gpt-image-2', display_name: 'GPT Image 2', output_modalities: ['image'], modes: ['text_to_image'], blocked_features: [], enabled: true },
]

const sse = (events: any[]) => new ReadableStream<Uint8Array>({
  start(c) { const e = new TextEncoder(); for (const ev of events) c.enqueue(e.encode(`data: ${JSON.stringify(ev)}\n\n`)); c.close() },
})
globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.hostname === 'api.x.ai') {
    xaiCalls++
    xaiBody = String(init?.body ?? '')
    return new Response(sse([{ type: 'response.created' }, { type: 'response.completed', response: xaiResponse }]), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  if (url.pathname.endsWith('/functions/v1/log-provider-call')) { logged.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }) }
  if (url.pathname === '/rest/v1/ai_models') return new Response(JSON.stringify(CATALOG), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.pathname === '/rest/v1/provider_calls') {
    if (!spendReadable) return new Response(JSON.stringify({ message: 'down' }), { status: 503, headers: { 'content-type': 'application/json' } })
    const rows = (url.searchParams.get('select') ?? '').includes('request_id') ? callRows : costRows
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  throw new Error(`unexpected fetch ${url}`)
}) as typeof fetch

const completed = (text: string, usage: any) => ({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text, annotations: [
    { type: 'url_citation', url: 'https://x.com/someone/status/2101000000000000001' },
    { type: 'url_citation', url: 'https://x.com/i/status/2101000000000000002' },
  ] }] }],
  usage,
})
const POSTS = JSON.stringify({ posts: [{ url: 'https://x.com/a/status/2101000000000000003', handle: 'a', likes: 10, models: ['Seedance 2.5'], summary: { en: 'x' } }] })

async function main() {
  const { searchX, monthSpend, reportedCost, serviceClient, SEARCH_EST_USD } = await import('../lib/trending-job')
  const { supportFrom } = await import('../lib/trending-models')
  const support = supportFrom([{ provider: 'runway', model_name: 'seedance2_5', display_name: 'Seedance 2.5', output_modalities: ['video'], modes: ['text_to_video'], blocked_features: [], enabled: true }])
  const group = support.families
  const endsFor = (id: string) => logged.filter(l => l.action === 'end' && l.request_id === id)
  const lastStart = () => logged.filter(l => l.action === 'start').at(-1)!.request_id

  // reportedCost: only a finite, non-negative number is a cost.
  assert.equal(reportedCost({ cost_in_usd_ticks: 17867440000 }), 1.786744)
  assert.equal(reportedCost({ cost_in_usd_ticks: 0 }), 0)
  for (const bad of [undefined, null, '', 'abc', -5, Infinity]) assert.equal(reportedCost({ cost_in_usd_ticks: bad }), null, `ticks ${String(bad)}`)
  assert.equal(reportedCost(undefined), null)

  // 1. No cost in the response: null, not $0, and one end row.
  xaiResponse = completed(POSTS, { input_tokens: 10, output_tokens: 5 })
  const a = await searchX('video', '2026-08-28', '2026-09-27', group, support)
  const aId = lastStart()
  assert.equal(a.costUsd, null, 'missing cost stays null')
  assert.equal(a.posts.length, 1)
  assert.equal(endsFor(aId).length, 1, 'one end row')
  assert.equal(endsFor(aId)[0].cost_usd, null, 'logged cost is null, never 0')
  assert.equal(endsFor(aId)[0].usage_metadata.returned.length, 1, 'returned records on the end row')
  assert.deepEqual(endsFor(aId)[0].usage_metadata.cited, ['2101000000000000001', '2101000000000000002'], 'cited ids on the end row')
  assert.equal(endsFor(aId)[0].usage_metadata.max_turns, 8)

  // 2. An answer that isn't JSON: exactly one end row (success, with the
  //    parse error), no posts, the reported cost kept.
  xaiResponse = completed('Here you go: {not json', { cost_in_usd_ticks: 17867440000 })
  const b = await searchX('video', '2026-08-28', '2026-09-27', group, support)
  const bId = lastStart()
  assert.equal(b.posts.length, 0)
  assert.equal(b.costUsd, 1.786744)
  assert.equal(endsFor(bId).length, 1, 'one end row on malformed JSON (it was two)')
  assert.equal(endsFor(bId)[0].status, 'success')
  assert.ok(endsFor(bId)[0].usage_metadata.parse_error, 'parse error recorded')

  // 3. An unreadable cost is unknown too.
  xaiResponse = completed(POSTS, { cost_in_usd_ticks: 'abc' })
  const c = await searchX('video', '2026-08-28', '2026-09-27', group, support)
  assert.equal(c.costUsd, null)
  assert.equal(endsFor(lastStart())[0].cost_usd, null)

  // 4. The month's spend: logged costs, plus every unknown one (null,
  //    unreadable, or a start with no end) at SEARCH_EST_USD.
  assert.equal(SEARCH_EST_USD, 3.34, 'plans at the dearest measured search')
  costRows = [{ cost_usd: 1.786744 }, { cost_usd: null }, { cost_usd: 'abc' }, { cost_usd: '0.5' }]
  callRows = [
    { request_id: 'a', event: 'start' }, { request_id: 'a', event: 'end' },
    { request_id: 'b', event: 'start' }, { request_id: 'b', event: 'end' },
    { request_id: 'c', event: 'start' },
  ]
  const spent = await monthSpend(serviceClient(), new Date('2026-09-27T12:00:00Z'))
  assert.equal(Math.round(spent * 1e6) / 1e6, Math.round((1.786744 + 0.5 + 3 * SEARCH_EST_USD) * 1e6) / 1e6)

  // 5. Planning under the month's budget (Codex review): only the searches
  //    that fit, kinds alternating, groups rotating by week, the rest deferred.
  const { planSearches, runTrendingKinds } = await import('../lib/trending-job')
  const fam = (name: string) => ({ name, terms: [name], mention: new RegExp(name, 'i'), kinds: [] as any[], solo: false, models: [] })
  const G = { video: [[fam('V0')], [fam('V1')], [fam('V2')], [fam('V3')]], image: [[fam('I0')], [fam('I1')]] }
  const names = (p: { kind: string; group: any[] }[]) => p.map(x => x.group[0].name)
  assert.deepEqual(names(planSearches(G, 0, 0).chosen), [], 'nothing fits: nothing chosen')
  assert.equal(planSearches(G, 0, 0).deferred.length, 6, 'everything deferred')
  assert.deepEqual(names(planSearches(G, 2, 0).chosen), ['V0', 'I0'], 'two slots: one of each kind')
  assert.deepEqual(names(planSearches(G, 2, 1).chosen), ['I1', 'V1'], 'next week: the other kind first, next groups')
  assert.deepEqual(names(planSearches(G, 1, 0).chosen), ['V0'])
  assert.deepEqual(names(planSearches(G, 1, 1).chosen), ['I0'], 'one slot alternates kinds by week')
  const singleSlotCoverage = new Set<string>()
  for (let w = 0; w < 8; w++) names(planSearches(G, 1, w).chosen).forEach(n => singleSlotCoverage.add(n))
  assert.deepEqual([...singleSlotCoverage].sort(), ['I0', 'I1', 'V0', 'V1', 'V2', 'V3'], 'eight one-slot weeks: both kinds and every group get a turn')
  assert.equal(planSearches(G, 99, 0).chosen.length, 6, 'room for all: all')
  assert.equal(planSearches(G, 2.9, 0).chosen.length, 2, 'a partial search does not fit')
  const covered = new Set<string>()
  for (let w = 0; w < 4; w++) names(planSearches(G, 2, w).chosen).forEach(n => covered.add(n))
  assert.deepEqual([...covered].sort(), ['I0', 'I1', 'V0', 'V1', 'V2', 'V3'], 'four weeks at two a week: every group gets a turn')
  assert.deepEqual(names(planSearches({ image: G.image }, 1, 3).chosen), ['I1'], 'one kind (the admin run) rotates too')

  // 6. A run refuses before any provider call when no search fits, or when
  //    the month's spend can't be read.
  const at = new Date('2026-10-05T01:00:00Z')
  costRows = [{ cost_usd: 7.0 }]; callRows = [{ request_id: 'x', event: 'start' }, { request_id: 'x', event: 'end' }]
  xaiCalls = 0
  await assert.rejects(runTrendingKinds(['video', 'image'], at), /no search at \$3\.34 fits.*Deferred: /)
  assert.equal(xaiCalls, 0, 'no provider call when nothing fits')
  spendReadable = false
  await assert.rejects(runTrendingKinds(['video', 'image'], at), /budget unreadable/)
  assert.equal(xaiCalls, 0, 'no provider call when spend is unreadable')
  spendReadable = true

  // The likes bar (owner, Sep 30: "yes 1k is the minimum bar"). Under it, or
  // with no count, a post is dropped before its text is checked and before
  // anything is stored: the mocked fetch throws on any call this makes.
  {
    const { ingestCandidates } = await import('../lib/trending-job')
    const { TRENDING_MIN_LIKES, meetsLikesBar } = await import('../app/xcreate/trending')
    assert.equal(TRENDING_MIN_LIKES, 1000)
    for (const [likes, ok] of [[1000, true], [34730, true], [999, false], [30, false], [0, false], [null, false], [undefined, false], ['1200', false]] as const) {
      assert.equal(meetsLikesBar(likes), ok, `likes ${String(likes)}`)
    }
    const under = [
      { url: 'https://x.com/a/status/2101000000000000011', handle: 'a', likes: 999, models: ['Seedance 2.5'], summary: { en: 'x' } },
      { url: 'https://x.com/b/status/2101000000000000012', handle: 'b', likes: null, models: ['Seedance 2.5'], summary: { en: 'x' } },
      { url: 'https://x.com/c/status/2101000000000000013', handle: 'c', models: ['Seedance 2.5'], summary: { en: 'x' } },
    ]
    const { report, rows } = await ingestCandidates(serviceClient(), 'video', under as any, at, false, support)
    assert.equal(rows.length, 0)
    assert.equal(report.inserted, 0)
    assert.deepEqual(report.dropped.map(d => d.reason), ['under 1000 likes (999)', 'under 1000 likes (count unknown)', 'under 1000 likes (count unknown)'])
    // The search asks for the bar and is no longer told it may go lower.
    assert.ok(xaiBody.includes('min_faves:1000'), 'the search asks for 1k+')
    assert.ok(!/min_faves:(300|100)\b/.test(xaiBody) && !/Lower min_faves/.test(xaiBody), 'no lower floor offered')
    assert.ok(/Never search below min_faves:1000/.test(xaiBody))
  }

  console.log('PASS: the 1,000-like bar drops a post before any check or write and the search asks for it; missing or unreadable cost logged as null (never $0), one end row on malformed JSON, returned records and citations on the end row, month spend counts unknowns at the measured estimate; budget planning picks only what fits (kinds alternate, groups rotate weekly, the rest deferred) and refuses with no provider call when nothing fits or spend is unreadable')
}
main().catch(err => { console.error(err); process.exit(1) })
