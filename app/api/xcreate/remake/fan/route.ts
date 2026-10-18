// app/api/xcreate/remake/fan/route.ts: starting a 風扇變裝 run, the template
// in 同款's tab (lib/fan-template, Oct 18).
//
//   POST { front, consent, outfits: [{ text, photo? }] x2-5, scene?: { blade?, sofa?,
//          carpet?, floor?: { text?, photo? } }, music, language }
//        → { id, job }: the reserve is taken, the run is a Library item, and
//          the work goes on after the answer (GET .../fan/<id> follows it)
//
// Photos (theirs, the outfits', the scene's) and the music track must be the
// viewer's own uploads; their own photo needs the consent tick; every word
// they typed is moderated first.

export const runtime = 'nodejs'
export const maxDuration = 800

import { after, type NextRequest } from 'next/server'
import { isOwnUpload } from '@/lib/platform-specs'
import { moderate } from '@/lib/moderation'
import { driveFan, fanView, FanError, startFan } from '@/lib/fan-template/job'
import { service } from '@/lib/remake/store'
import { FAN_MUSIC_STYLES, MAX_OUTFITS, MIN_OUTFITS, type FanMusic, type FanRequest, type FanScene, type FanScenePart } from '@/lib/fan-template/recipe'

const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => Response.json({ code, ...extra }, { status })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max)

async function viewer() {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const { data: { user } } = await (await createSupabaseServer()).auth.getUser()
  return user
}

function parse(userId: string, b: any): FanRequest | string {
  if (!b || typeof b !== 'object') return 'bad_request'
  const own = (p: unknown) => typeof p === 'string' && isOwnUpload(userId, p) ? p : undefined
  const front = own(b.front)
  if (!front) return 'missing_photo'
  if (b.consent !== true) return 'consent'
  const outfits = (Array.isArray(b.outfits) ? b.outfits : []).slice(0, MAX_OUTFITS).map((o: any) => ({ text: str(o?.text, 60), ...(own(o?.photo) ? { photo: own(o?.photo) } : {}) }))
  if (outfits.length < MIN_OUTFITS || outfits.some((o: any) => !o.text)) return 'missing_outfit'
  // The scene is optional, part by part: words, a photo, or both.
  const part = (p: any): FanScenePart | undefined => {
    const text = str(p?.text, 60), photo = own(p?.photo)
    return text || photo ? { ...(text ? { text } : {}), ...(photo ? { photo } : {}) } : undefined
  }
  const scene: FanScene = {}
  for (const k of ['blade', 'sofa', 'carpet', 'floor'] as const) { const p = part(b.scene?.[k]); if (p) scene[k] = p }
  const m = b.music ?? {}
  const choice: FanMusic['choice'] = ['style', 'mine', 'none'].includes(m.choice) ? m.choice : 'style'
  const track = choice === 'mine' ? own(m.track) : undefined
  if (choice === 'mine' && !track) return 'no_track'
  return {
    front, outfits, ...(Object.keys(scene).length ? { scene } : {}),
    music: { choice, style: FAN_MUSIC_STYLES.includes(m.style) ? m.style : 'pop', ...(track ? { track } : {}) },
    language: str(b.language, 12) || 'en',
  }
}

export async function POST(req: NextRequest) {
  const user = await viewer()
  if (!user) return fail(401, 'unauthorized')
  const body = await req.json().catch(() => null)
  const request = parse(user.id, body)
  if (typeof request === 'string') return fail(400, request)
  const words = [...request.outfits.map(o => o.text), ...Object.values(request.scene ?? {}).map(p => p?.text)].filter(Boolean).join('\n')
  const verdict = await moderate({ text: words })
  if (verdict === 'refused') return fail(400, 'refused')
  if (verdict === 'unavailable') return fail(503, 'moderation_unavailable')
  try {
    const job = await startFan(user.id, request, { title: str(body?.cardTitle, 60) || '風扇變裝' })
    after(() => driveFan(user.id, job.id))
    return Response.json({ id: job.id, job: await fanView(service(), job) })
  } catch (e) {
    if (e instanceof FanError) return fail(e.status, e.message, e.extra)
    console.error('[fan:start] failed:', e)
    return fail(500, 'start_failed')
  }
}
