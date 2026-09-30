// app/api/xtell/daily/route.ts — today's free fortune for the signed-in
// visitor's saved profile: Western transits and the BaZi day, each computed
// at the day's anchor and explained by the house model.
//
// Free, always: nothing here imports the wallet, and a failed generation
// leaves the day's basis on screen with "not ready" rather than turning into
// a paid reading. The owner pays for the writing, kept small by the cache:
// one generation per user, local date, zone, profile version, method, rules
// version and language, claimed through supabase/109 so two tabs or two
// instances never write the same day twice, and capped per user per UTC day.

export const runtime = 'nodejs'
export const maxDuration = 60

import { after } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { ndjsonResponse } from '@/lib/partial-json'
import { xtellAdmin, dailyMissing } from '@/lib/xtell-admin'
import { dailyText } from '@/lib/xtell-daily-model'
import { inLanguage } from '@/lib/xtell-lang-check'
import {
  DAILY_METHODS, DAILY_RULES, asDailyLang, dailyBases, basisFacts, dailyBrief, parseDailyReading, profileProblem,
  type DailyMethod, type DailyProfile, type DailyBases,
} from '@/lib/xtell-daily'

// The writer is Qwen 3.8 Flash, with a stand-in on failure: see
// lib/xtell-daily-model.ts (the visitor chose no model here).
const LEASE = { staleSeconds: 120, cooldownSeconds: 600, maxPerDay: 16, keepDays: 30 }

const hits = new Map<string, number[]>()
function overLimit(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter(t => now - t < 60_000)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  return recent.length > 12
}

/** What a method's basis looks like stored and sent: the day, and only that
 *  method's computed facts (never the other method's). */
const basisOf = (m: DailyMethod, b: DailyBases) => ({ date: b.date, tz: b.tz, anchor: new Date(b.anchor).toISOString(), ...(m === 'western' ? { western: b.western } : { bazi: b.bazi }) })

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  if (overLimit(ip)) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const body = await req.json().catch(() => ({}))
  const lang = asDailyLang(body?.lang)

  const db = xtellAdmin()
  const { data: row, error } = await db.from('xtell_profiles').select('birth, birth_place, fold, display_tz, revision').eq('user_id', user.id).maybeSingle()
  if (error) return dailyMissing(error) ? Response.json({ error: 'daily_unavailable' }, { status: 503 }) : Response.json({ error: 'daily_failed' }, { status: 500 })
  if (!row) return Response.json({ profile: null })
  const profile: DailyProfile = { birth: row.birth, place: row.birth_place, fold: row.fold === 0 || row.fold === 1 ? row.fold : null, displayTz: row.display_tz, revision: row.revision }
  const problem = profileProblem(profile)
  if (problem) return Response.json({ profile: true, problem })

  const bases = dailyBases(profile)
  type Emit = (e: Record<string, unknown>) => void
  const one = async (m: DailyMethod, emit?: Emit) => {
    const basis = basisOf(m, bases)
    const token = crypto.randomUUID()
    const { data: claimed, error: claimError } = await db.rpc('xtell_daily_claim', {
      p_user: user.id, p_date: bases.date, p_tz: bases.tz, p_revision: profile.revision, p_method: m, p_rules: DAILY_RULES[m], p_lang: lang,
      p_token: token, p_stale_seconds: LEASE.staleSeconds, p_cooldown_seconds: LEASE.cooldownSeconds, p_max_per_day: LEASE.maxPerDay, p_keep_days: LEASE.keepDays,
    })
    if (claimError) throw claimError
    const c = Array.isArray(claimed) ? claimed[0] : claimed
    if (!c) return { status: 'failed' as const, basis }
    if (c.outcome === 'ready') return { status: 'ready' as const, id: c.row_id, basis: c.basis ?? basis, reading: c.reading }
    if (c.outcome === 'gone') return { status: 'gone' as const }
    if (c.outcome !== 'claimed') return { status: c.outcome as 'pending' | 'failed' | 'capped', basis }
    // Streaming (Sep 29): the card shows the basis at once and the reading
    // as it is written; the saved, checked reading still comes last.
    emit?.({ t: 'writing', m, basis })
    let reading = null
    try {
      const text = await dailyText({
        // Readable, and in the page's language: a reply in another language
        // is refused here, and the stand-in model writes the day instead.
        system: dailyBrief(m, lang), content: basisFacts(m, bases), userId: user.id, accept: t => { const r = parseDailyReading(t); return !!r && inLanguage([r.summary, ...r.themes, r.reflect, r.why].join(' '), lang) },
        onDelta: emit && (d => emit({ t: 'd', m, d })), onRestart: emit && (() => emit({ t: 'restart', m })),
      })
      reading = text ? parseDailyReading(text) : null
      // Generic on purpose: never the model's text or the profile.
      if (!reading) console.warn('[xtell/daily] no readable reply')
    } catch {
      // Generic: a provider error can quote the request, and the request
      // holds the visitor's chart (Codex review).
      console.warn('[xtell/daily] no provider could answer')
    }
    const { data: written } = await db.rpc('xtell_daily_finish', {
      p_user: user.id, p_id: c.row_id, p_token: token, p_revision: profile.revision, p_ok: !!reading, p_basis: basis, p_reading: reading,
    })
    if (written !== true) return { status: 'gone' as const }
    return reading ? { status: 'ready' as const, id: c.row_id, basis, reading } : { status: 'failed' as const, basis }
  }
  const failure = (e: any) => {
    if (dailyMissing(e)) return 'daily_unavailable'
    console.warn('[xtell/daily] claim failed:', typeof e?.code === 'string' ? e.code : 'unknown')
    return 'daily_failed'
  }
  // The page asks for a stream (Sep 29); an older page still open in a tab
  // asks without, and gets the whole day as one answer, as before.
  if (body?.stream === true) {
    return ndjsonResponse(async emit => {
      emit({ t: 'day', profile: true, date: bases.date, tz: bases.tz, revision: profile.revision })
      await Promise.all(DAILY_METHODS.map(async m => {
        try { emit({ t: 'm', m, data: await one(m, emit) }) } catch (e) { emit({ t: 'm', m, error: failure(e) }) }
      }))
    }, p => after(p))
  }
  try {
    const [western, bazi] = await Promise.all(DAILY_METHODS.map(m => one(m)))
    return Response.json({ profile: true, date: bases.date, tz: bases.tz, revision: profile.revision, methods: { western, bazi } })
  } catch (e: any) {
    const code = failure(e)
    return Response.json({ error: code }, { status: code === 'daily_unavailable' ? 503 : 500 })
  }
}
