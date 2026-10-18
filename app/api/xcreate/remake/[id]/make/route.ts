// app/api/xcreate/remake/[id]/make/route.ts: making the remake of one kept
// 同款 read (lib/remake/make.ts, Oct 17).
//
//   POST { choices } → starts it (or returns the one already running): the
//                      price is reserved, the work runs after the answer
//   GET              → its progress, and the video once it exists; a pass
//                      whose lease ran out is picked up again here, so the open
//                      page keeps a remake moving
//
// Photos and recordings must be the viewer's own uploads; a person's photo or
// voice needs the consent tick; every word the viewer typed is moderated
// before anything is spent.

export const runtime = 'nodejs'
export const maxDuration = 800

import { after, type NextRequest } from 'next/server'
import { isOwnUpload } from '@/lib/platform-specs'
import { moderate } from '@/lib/moderation'
import { driveMake, isActive, loadJob, makeView, MakeError, service, startMake, type MakeRequest } from '@/lib/remake/make'
import { DEFAULT_TUNE, MUSIC_TARGETS, REMAKE_LOOKS, type MusicChoice, type MusicTune, type VoiceChoice } from '@/lib/remake/config'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CAST = ['keep', 'photo', 'describe', 'famous'], THING = ['keep', 'photo', 'describe', 'remove'], PLACE = ['keep', 'photo', 'describe']
const MUSIC: MusicChoice[] = ['keep', 'tune', 'mine', 'none']
const VOICE: VoiceChoice[] = ['ai', 'mine', 'none']
/** A speaker id as the read writes it (c1, or a narrator's name in any script). */
const SPEAKER = /^[^\u0000-\u001f]{1,12}$/

async function viewer() {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const { data: { user } } = await (await createSupabaseServer()).auth.getUser()
  return user
}
const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => Response.json({ code, ...extra }, { status })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v : '').trim().slice(0, max)
const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }

/** The page's choices, checked: unknown keys dropped, photos only from the
 *  viewer's own folder, a person's photo only with the consent tick. */
function parseChoices(userId: string, c: any): MakeRequest | string {
  if (!c || typeof c !== 'object') return 'bad_choices'
  const pick = <T extends string>(o: any, allowed: string[], photoOk: boolean, needsConsent = false) => {
    const out: Record<string, { choice: T; text: string; photo?: string; consent?: boolean }> = {}
    for (const [id, v] of Object.entries(o ?? {})) {
      if (!/^[\w-]{1,20}$/.test(id) || !v || typeof v !== 'object') continue
      const p = v as any
      const choice = allowed.includes(p.choice) ? p.choice as T : allowed[0] as T
      const photo = choice === 'photo' && photoOk && typeof p.photo === 'string' && isOwnUpload(userId, p.photo) ? p.photo : undefined
      if (choice === 'photo' && !photo) continue                    // no photo, no swap: keep
      if (choice === 'photo' && needsConsent && !p.consent) continue
      out[id] = { choice, text: str(p.text, 200), ...(photo ? { photo } : {}), ...(needsConsent ? { consent: !!p.consent } : {}) }
    }
    return out
  }
  const m = c.music ?? {}
  const choice: MusicChoice = MUSIC.includes(m.choice) ? m.choice : 'keep'
  const t = m.tune ?? {}
  const tune: MusicTune = {
    target: (MUSIC_TARGETS as readonly string[]).includes(t.target) ? t.target : DEFAULT_TUNE.target,
    amount: num(t.amount, 0, 100, DEFAULT_TUNE.amount), tempo: num(t.tempo, -50, 50, 0), energy: num(t.energy, -50, 50, 0), vocals: !!t.vocals,
  }
  const track = choice === 'mine' && typeof m.track === 'string' && isOwnUpload(userId, m.track) ? m.track : undefined
  if (choice === 'mine' && !track) return 'no_track'
  // A recording of someone's voice, like a photo of their face, needs the tick.
  const voices: MakeRequest['voices'] = {}
  for (const [who, v] of Object.entries(c.voices ?? {}).slice(0, 20)) {
    if (!SPEAKER.test(who) || !v || typeof v !== 'object') continue
    const p = v as any
    const vc: VoiceChoice = VOICE.includes(p.choice) ? p.choice : 'ai'
    const recording = vc === 'mine' && p.consent && typeof p.recording === 'string' && isOwnUpload(userId, p.recording) ? p.recording : undefined
    voices[who] = vc === 'mine' ? (recording ? { choice: 'mine', recording } : { choice: 'ai' }) : { choice: vc }
  }
  const texts: Record<string, string> = {}
  for (const [was, now] of Object.entries(c.texts ?? {}).slice(0, 40)) {
    const own = str(now, 120)
    if (own && was.length <= 300) texts[was.trim()] = own
  }
  return {
    from: num(c.from, 0, 6 * 3600, 0), seconds: num(c.seconds, 1, 180, 15),
    cast: pick(c.cast, CAST, true, true), things: pick(c.things, THING, true), places: pick(c.places, PLACE, true),
    theme: str(c.theme, 300), setting: str(c.setting, 300),
    look: (REMAKE_LOOKS as string[]).includes(c.look) ? c.look : 'keep',
    language: str(c.language, 12) || 'en',
    product: typeof c.product === 'string' && isOwnUpload(userId, c.product) ? c.product : undefined,
    music: { choice, tune, ...(track ? { track } : {}) },
    voices, texts,
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await viewer()
  if (!user) return fail(401, 'unauthorized')
  const { id } = await params
  if (!UUID.test(id)) return fail(404, 'not_found')
  const body = await req.json().catch(() => null) as any
  const request = parseChoices(user.id, body?.choices)
  if (typeof request === 'string') return fail(400, request)
  // Every word the viewer typed, before anything is spent.
  const words = [request.theme, request.setting, ...Object.values(request.texts),
    ...Object.values(request.cast).map(p => p.text), ...Object.values(request.things).map(p => p.text), ...Object.values(request.places).map(p => p.text)]
    .filter(Boolean).join('\n')
  if (words) {
    const verdict = await moderate({ text: words })
    if (verdict === 'refused') return fail(400, 'refused')
    if (verdict === 'unavailable') return fail(503, 'moderation_unavailable')
  }
  try {
    const job = await startMake(user.id, id, request)
    if (isActive(job.status)) after(() => driveMake(user.id, id))
    return Response.json({ job: await makeView(service(), job) })
  } catch (e) {
    if (e instanceof MakeError) return fail(e.status, e.message, e.extra)
    console.error('[remake:make] start failed:', e)
    return fail(500, 'start_failed')
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await viewer()
  if (!user) return fail(401, 'unauthorized')
  const { id } = await params
  if (!UUID.test(id)) return fail(404, 'not_found')
  const sb = service()
  const job = await loadJob(sb, user.id, id)
  if (!job) return Response.json({ job: null })
  if (isActive(job.status) && job.leaseUntil < Date.now()) after(() => driveMake(user.id, id))
  return Response.json({ job: await makeView(sb, job) })
}
