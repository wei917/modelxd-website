// lib/xtell-admin.ts — the service-role client for XTell's server-only tables
// (supabase/109: profiles, daily readings, usage). Those tables have no
// policies and no grants to signed-in users, so every read and write goes
// through a route that has verified the session and passes THAT user's id
// into the query or function (Codex review: RLS does not bind the service
// role; the query must).

import { createClient } from '@supabase/supabase-js'

export function xtellAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('xtellAdmin: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

/** The error Supabase gives while migration 109 has not been run: the daily
 *  feature then answers 503 daily_unavailable and the street hides it. */
export const dailyMissing = (e: any): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /does not exist|schema cache|could not find/i.test(String(e.message ?? '')))
