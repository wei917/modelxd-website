// lib/xsports-ai-spend.ts — what ModelXD spends on X體育's AI commentators
// each Taipei day, against the day's cap (owner, Oct 15: "so we can cap $50
// a day for sports? when it hits cap, how do I know?"). Each remark's cost,
// the provider's own count as the call log has it, is added to
// xsports_ai_spend (supabase/135). Once the day reaches the cap, every room
// speaks with the cheap pair until Taipei midnight; /admin/traffic shows
// the day and when it hit. Server only (the service key).
//
// It fails closed: when the day cannot be read (the table is not there yet,
// the database errs) the rooms use the cheap pair, never the top models.

import { xsportsAdmin } from './xsports-store'

/** The day's cap in US dollars: XSPORTS_AI_DAILY_USD, else $50. */
export const DAILY_CAP_USD = Number(process.env.XSPORTS_AI_DAILY_USD) > 0 ? Number(process.env.XSPORTS_AI_DAILY_USD) : 50

/** Today in Taipei, YYYY-MM-DD: a US game day falls inside one. */
export const taipeiDay = (at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)

export interface SpendDay { day: string; usd: number; remarks: number; capped_at: string | null }

/** The last `days` Taipei days that spent anything, newest first; null when
 *  they cannot be read. */
export async function spendDays(days = 7): Promise<SpendDay[] | null> {
  const from = taipeiDay(new Date(Date.now() - (days - 1) * 86_400_000))
  const { data, error } = await xsportsAdmin().from('xsports_ai_spend').select('day, usd, remarks, capped_at').gte('day', from).order('day', { ascending: false })
  if (error) return null
  return (data ?? []).map((r: any) => ({ day: String(r.day), usd: Number(r.usd), remarks: Number(r.remarks), capped_at: r.capped_at ?? null }))
}

// Every remark asks; one read per 30 s per server is plenty.
let seen: { day: string; at: number; over: boolean } | null = null

/** Whether today has reached the cap (or cannot be read). */
export async function overCapToday(): Promise<boolean> {
  const day = taipeiDay()
  if (seen && seen.day === day && Date.now() - seen.at < 30_000) return seen.over
  const { data, error } = await xsportsAdmin().from('xsports_ai_spend').select('usd').eq('day', day).maybeSingle()
  if (error) console.warn('[xsports/ai-spend] read', error.code, error.message)
  const over = !!error || Number(data?.usd ?? 0) >= DAILY_CAP_USD
  seen = { day, at: Date.now(), over }
  return over
}

/** One remark's cost, added to today; the remark that crosses the cap marks
 *  the time (capped_at). */
export async function addSpend(usd: number): Promise<void> {
  if (!Number.isFinite(usd) || usd < 0) return
  const day = taipeiDay()
  const { data, error } = await xsportsAdmin().rpc('add_xsports_ai_spend', { p_day: day, p_usd: usd, p_cap: DAILY_CAP_USD })
  if (error) { console.warn('[xsports/ai-spend] add', error.code, error.message); return }
  const row = Array.isArray(data) ? data[0] : data
  if (row && Number(row.usd) >= DAILY_CAP_USD) seen = { day, at: Date.now(), over: true }
}
