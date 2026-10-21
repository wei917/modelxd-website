// app/api/xcreate/voices/route.ts — your own voice for X創作's 語音 (owner,
// Oct 20: "clone voice and ask the ai to speak some text with cloned
// voice", then "go ahead to do it").
//
//   GET     your voices (no provider ids), the cap and the first-use fee
//   POST    multipart { audio, name, lang, consent: '1' }: a recording of
//           you reading the page's passage (lib/voice-passages.ts) →
//           Whisper checks you read it → MiniMax clones it → a row in
//           xcreate_voices (migration 144)
//   PATCH   JSON { id, name }: rename (the Profile page's 我的聲音)
//   DELETE  ?id=<row>: gone from MiniMax and from your list
//
// Own voice only, and that is the point of the passage: a recording of
// someone else (an interview, a video) never says these words, so it fails
// the check. That replaces the Aug 8 rule of no cloning at all
// (app/api/xcharacter/tts/route.ts), which held because consent for a
// recorded voice could not be checked.
//
// Cloning is free; MiniMax charges $1.50 when the voice FIRST speaks, and
// the X創作 route charges the person then (lib/xcreate-voices.ts). Whisper's
// read is house-paid (about $0.003 a try), so tries are capped per day. The
// recording is never stored.

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'
import * as providers from '@/lib/providers'
import { cloneVoice, deleteVoice, VOICE_CLONE_USD } from '@/lib/providers/minimax'
import { isVerifiedAccount } from '@/lib/verified-account'
import { MAX_SECONDS, MIN_SECONDS, PASS_SCORE, passageLang, readingScore } from '@/lib/voice-passages'
import { listVoices, MAX_TRIES_PER_DAY, MAX_VOICES, newVoiceId, toMyVoice, TRY_EVENT, type VoiceRow } from '@/lib/xcreate-voices'

const LOG = '[xcreate:voices]'
const MAX_BYTES = 4_000_000

const fail = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  Response.json({ code, ...extra }, { status })

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

async function viewer() {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

/** Postgres: the table is not there yet (144 not run). */
const missingTable = (e: any) => e?.code === '42P01' || e?.code === 'PGRST205' || /xcreate_voices/.test(String(e?.message ?? ''))

export async function GET() {
  const user = await viewer()
  if (!user) return fail(401, 'unauthorized')
  try {
    const rows = await listVoices(admin(), user.id)
    return Response.json({ ready: true, voices: rows.map(toMyVoice), max: MAX_VOICES, feeUsd: VOICE_CLONE_USD })
  } catch (e) {
    if (missingTable(e)) return Response.json({ ready: false, voices: [], max: MAX_VOICES, feeUsd: VOICE_CLONE_USD })
    console.error(`${LOG} list:`, e)
    return fail(500, 'list_failed')
  }
}

export async function POST(req: Request) {
  const user = await viewer()
  if (!user) return fail(401, 'unauthorized')
  if (!isVerifiedAccount(user)) return fail(403, 'unverified')

  const form = await req.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof Blob) || !audio.size) return fail(400, 'no_audio')
  if (audio.size > MAX_BYTES) return fail(413, 'too_big')
  if (String(form?.get('consent') ?? '') !== '1') return fail(400, 'no_consent')
  const lang = passageLang(form?.get('lang'))
  const name = String(form?.get('name') ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 30) || 'My voice'
  const mediaType = (audio.type || 'audio/wav').split(';')[0]
  if (!mediaType.startsWith('audio/')) return fail(415, 'not_audio')

  const sb = admin()
  let have: VoiceRow[]
  try { have = await listVoices(sb, user.id) }
  catch (e) { return missingTable(e) ? fail(503, 'not_ready') : fail(500, 'list_failed') }
  if (have.length >= MAX_VOICES) return fail(409, 'too_many', { max: MAX_VOICES })

  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { count } = await sb.from('activity_logs').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('event', TRY_EVENT).gte('created_at', since)
  if ((count ?? 0) >= MAX_TRIES_PER_DAY) return fail(429, 'daily_cap', { cap: MAX_TRIES_PER_DAY })

  const buffer = Buffer.from(await audio.arrayBuffer())
  const { data: asr } = await sb.from('ai_models').select('*').eq('provider', 'openai').eq('model_name', 'whisper-1').eq('enabled', true).maybeSingle()
  if (!asr) { console.error(`${LOG} whisper-1 missing or off in ai_models`); return fail(503, 'unavailable') }

  // Did they read the passage? Never with the passage as Whisper's prompt:
  // that would bias it to hear the very words being checked.
  let heard = '', seconds = 0, asrCost = 0
  try {
    const r = await providers.transcribeAudio(asr as any, { buffer, mediaType }, null, { userId: user.id })
    heard = (r as any).rawText ?? r.text
    seconds = r.durationSeconds
    asrCost = r.cost
  } catch (e) {
    console.error(`${LOG} transcribe:`, (e as Error).message)
    return fail(502, 'check_failed')
  }
  const score = Math.round(readingScore(heard, lang) * 100) / 100
  await sb.from('activity_logs').insert({
    user_id: user.id, event: TRY_EVENT,
    metadata: { lang, bytes: buffer.length, seconds: Math.round(seconds * 10) / 10, score, cost_usd: Math.round(asrCost * 10000) / 10000 },
  })
  console.log(`${LOG} ${user.id} ${lang} ${seconds.toFixed(1)}s score=${score}`)
  if (seconds && seconds < MIN_SECONDS - 0.3) return fail(422, 'too_short', { seconds, min: MIN_SECONDS })
  if (seconds > MAX_SECONDS + 3) return fail(422, 'too_long', { seconds, max: MAX_SECONDS })
  if (score < PASS_SCORE) return fail(422, 'reading_mismatch', { score })

  const voiceId = newVoiceId(user.id)
  try {
    await cloneVoice(buffer, mediaType, voiceId, lang)
  } catch (e) {
    const msg = (e as Error).message
    console.error(`${LOG} clone:`, msg)
    if (/moderation/.test(msg)) return fail(422, 'flagged')
    if (/\b2038\b/.test(msg)) return fail(503, 'clone_unavailable')
    if (/\b2013\b/.test(msg)) return fail(422, 'bad_audio')
    return fail(502, 'clone_failed')
  }

  const { data: row, error } = await sb.from('xcreate_voices')
    .insert({ user_id: user.id, provider: 'minimax', voice_id: voiceId, name, lang, read_score: score })
    .select('id, user_id, provider, voice_id, name, lang, first_used_at, created_at').single()
  if (error || !row) {
    console.error(`${LOG} insert:`, error)
    await deleteVoice(voiceId).catch(() => {})
    return fail(missingTable(error) ? 503 : 500, missingTable(error) ? 'not_ready' : 'save_failed')
  }
  return Response.json({ voice: toMyVoice(row as VoiceRow) })
}

/** Rename: JSON { id, name } (the Profile page's 我的聲音, Oct 20). */
export async function PATCH(req: Request) {
  const user = await viewer()
  if (!user) return fail(401, 'unauthorized')
  const body = await req.json().catch(() => null) as { id?: unknown; name?: unknown } | null
  const id = String(body?.id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, 'bad_id')
  const name = String(body?.name ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 30)
  if (!name) return fail(400, 'no_name')
  const { data: row, error } = await admin().from('xcreate_voices').update({ name })
    .eq('id', id).eq('user_id', user.id).is('deleted_at', null)
    .select('id, user_id, provider, voice_id, name, lang, first_used_at, created_at').maybeSingle()
  if (error) { console.error(`${LOG} rename:`, error); return fail(500, 'save_failed') }
  if (!row) return fail(404, 'not_found')
  return Response.json({ voice: toMyVoice(row as VoiceRow) })
}

export async function DELETE(req: Request) {
  const user = await viewer()
  if (!user) return fail(401, 'unauthorized')
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, 'bad_id')
  const sb = admin()
  const { data: row } = await sb.from('xcreate_voices').select('id, voice_id')
    .eq('id', id).eq('user_id', user.id).is('deleted_at', null).maybeSingle()
  if (!row) return fail(404, 'not_found')
  // Gone from MiniMax first; a voice MiniMax already dropped is gone too.
  await deleteVoice((row as any).voice_id).catch(() => false)
  await sb.from('xcreate_voices').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  return Response.json({ ok: true })
}
