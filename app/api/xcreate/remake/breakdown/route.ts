// app/api/xcreate/remake/breakdown/route.ts: 同款 (Remake), step one. A pasted
// link (or the user's own upload) becomes a shot list the remake follows.
//
//   POST { url } | { uploadPath }, optional { start } (seconds)
//
// YouTube: Gemini fetches the link itself; we never download it. X: the X API
// hands us the post's video file. Uploads: the user's own folder only. Files
// are watched from Gemini's file store and deleted, with our temp copy,
// before the response; nothing of the source is kept. Reads up to 3 minutes
// (owner, Oct 10). HOUSE-PAID, about $0.05 a minute, capped per user per day,
// and logged against the user in provider_calls like every other call.
// Since Oct 13 the read also names the materials to swap (people, things,
// places); for X and uploads a small picture of each is cut from the file
// while we still hold it and sent back inline (lib/remake/previews.ts).

export const runtime = 'nodejs'
export const maxDuration = 300

import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { analyzeVideo, uploadVideoFile, deleteVideoFile, type VideoSource } from '@/lib/providers'
import { sanitizeProviderError } from '@/lib/provider-errors'
import { isOwnUpload, UPLOAD_BUCKETS } from '@/lib/platform-specs'
import { classifyLink } from '@/lib/remake/source'
import { readXVideo, XReadError } from '@/lib/remake/x'
import { breakdownPrompt, joinPieces, knownSoFar, normalizeBreakdown, READ_PIECE_SECONDS } from '@/lib/remake/breakdown'
import { makePreviews } from '@/lib/remake/previews'
import { ffmpegPath } from '@/lib/xcut-render'
import {
  BREAKDOWN_DAILY_CAP, BREAKDOWN_EVENT, BREAKDOWN_FPS, BREAKDOWN_MODEL, REMAKE_MAX_SOURCE_SECONDS,
  type Breakdown, type BreakdownResult, type SourceKind,
} from '@/lib/remake/config'

const LOG = '[remake:breakdown]'
const MAX_FILE_BYTES = 300_000_000
const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }

const fail = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  Response.json({ code, ...extra }, { status })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail(401, 'unauthorized')

  // What to read.
  let kind: SourceKind, url: string | null = null, postId: string | null = null, uploadPath: string | null = null
  if (typeof body?.uploadPath === 'string' && body.uploadPath) {
    if (!isOwnUpload(user.id, body.uploadPath)) return fail(404, 'not_found')
    kind = 'upload'; uploadPath = body.uploadPath
  } else {
    const link = classifyLink(String(body?.url ?? ''))
    if (link.kind === 'invalid') return fail(400, 'invalid_link')
    if (link.kind === 'upload_only') return fail(400, 'upload_only', { platform: link.platform })
    kind = link.kind; url = link.url
    if (link.kind === 'x') postId = link.postId
  }
  let start = Math.max(0, Math.min(Math.floor(Number(body?.start) || 0), 6 * 3600))

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

  // Free, so capped: this many reads per user per 24 hours.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { count } = await admin.from('activity_logs').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('event', BREAKDOWN_EVENT).gte('created_at', since)
  const used = count ?? 0
  if (used >= BREAKDOWN_DAILY_CAP) return fail(429, 'daily_cap', { cap: BREAKDOWN_DAILY_CAP })

  const { data: model } = await admin.from('ai_models').select('*').eq('provider', 'google').eq('model_name', BREAKDOWN_MODEL).maybeSingle()
  if (!model) { console.error(`${LOG} model ${BREAKDOWN_MODEL} missing from ai_models`); return fail(503, 'unavailable') }

  const tmp = path.join(os.tmpdir(), `remake-${crypto.randomUUID()}`)
  let geminiFile: string | null = null
  let ext = '.mp4'
  try {
    let source: VideoSource
    let known: number | null = null
    if (kind === 'youtube') {
      source = { url: url! }
    } else {
      let bytes: Buffer
      if (kind === 'x') {
        const v = await readXVideo(postId!)
        known = v.durationSeconds
        const res = await fetch(v.mp4Url)
        const size = Number(res.headers.get('content-length') ?? 0)
        if (!res.ok || size > MAX_FILE_BYTES) return fail(502, 'x_unavailable')
        bytes = Buffer.from(await res.arrayBuffer())
      } else {
        ext = (path.extname(uploadPath!).toLowerCase() || '.mp4')
        if (!MIME[ext]) return fail(400, 'unsupported_file')
        const { data: file, error } = await admin.storage.from(UPLOAD_BUCKETS.video).download(uploadPath!)
        if (error || !file) return fail(404, 'not_found')
        if (file.size > MAX_FILE_BYTES) return fail(413, 'too_large')
        bytes = Buffer.from(await file.arrayBuffer())
      }
      await fs.writeFile(`${tmp}${ext}`, bytes)
      const up = await uploadVideoFile(`${tmp}${ext}`, MIME[ext])
      geminiFile = up.name
      source = { fileUri: up.fileUri, mimeType: up.mimeType }
    }
    // An upload's length comes from the page (the browser read the file);
    // it only plans the pieces, so a wrong one costs a short last piece.
    if (kind === 'upload' && Number.isFinite(Number(body?.seconds)) && Number(body.seconds) > 0) known = Number(body.seconds)
    if (known != null && start >= known - 1) start = 0
    const end = Math.min(start + REMAKE_MAX_SOURCE_SECONDS, known ?? Infinity)
    const lang = typeof body?.lang === 'string' ? body.lang : 'en'

    // Read in pieces of a minute (times drift past that), each told who has
    // appeared so far. YouTube's length is unknown: a piece that comes back
    // shorter than asked means the video ended.
    const pieces: { offset: number; b: Breakdown }[] = []
    let cost = 0
    for (let from = start; from < end - 0.5 && pieces.length < Math.ceil(REMAKE_MAX_SOURCE_SECONDS / READ_PIECE_SECONDS);) {
      const to = Math.min(from + READ_PIECE_SECONDS, end)
      const seen = knownSoFar(pieces)
      let part: Breakdown | null = null
      for (let attempt = 0; attempt < 2 && !part; attempt++) {
        try {
          const r = await analyzeVideo(model as any, breakdownPrompt(lang, from, seen), source,
            { fps: BREAKDOWN_FPS, startSec: from || undefined, endSec: to, json: true }, { userId: user.id })
          cost += r.cost
          part = normalizeBreakdown(r.text, to - from, { characters: seen.characters.map(c => c.id), things: seen.things.map(t => t.id), places: seen.places.map(x => x.id) })
          if (!part) console.warn(`${LOG} piece at ${from}s, attempt ${attempt + 1}: not a shot list (${r.text.slice(0, 120)})`)
        } catch (err) {
          // The first piece failing is the read failing; a later one (often
          // a YouTube video that ended on the piece's edge) ends the read there.
          if (!pieces.length && attempt === 1) throw err
          if (pieces.length) { console.warn(`${LOG} piece at ${from}s: ${(err as Error).message}`); break }
        }
      }
      if (!part) { if (!pieces.length) return fail(502, 'read_failed'); break }
      pieces.push({ offset: from - start, b: part })
      if (part.duration < (to - from) - 2) break
      from = to
    }
    const breakdown = joinPieces(pieces)
    // The pictures of the materials, from the file while we still have it.
    let previews: Record<string, string> | undefined
    if (kind !== 'youtube') {
      try { previews = await makePreviews(ffmpegPath(), `${tmp}${ext}`, start, breakdown) }
      catch (err) { console.warn(`${LOG} previews: ${(err as Error).message}`) }
    }

    await admin.from('activity_logs').insert({
      user_id: user.id, event: BREAKDOWN_EVENT,
      metadata: { kind, url, start, seconds: breakdown.duration, shots: breakdown.shots.length, things: breakdown.things.length, places: breakdown.places.length, cost_usd: Math.round(cost * 10000) / 10000 },
    })
    console.log(`${LOG} ${kind} ${url ?? 'upload'}: ${breakdown.shots.length} shots, ${breakdown.duration}s, $${cost.toFixed(4)}`)
    const result: BreakdownResult = {
      breakdown,
      source: { kind, url, start, end: Math.round((start + breakdown.duration) * 10) / 10 },
      costUsd: Math.round(cost * 10000) / 10000,
      left: Math.max(0, BREAKDOWN_DAILY_CAP - used - 1),
      previews,
    }
    return Response.json(result)
  } catch (err) {
    if (err instanceof XReadError) {
      console.warn(`${LOG} X: ${err.message}`)
      return fail(err.code === 'x_not_configured' ? 503 : 400, err.code === 'x_not_configured' ? 'unavailable' : err.code)
    }
    console.error(`${LOG} ${kind} ${url ?? uploadPath}: ${(err as Error).message}`)
    return fail(502, 'read_failed', { error: sanitizeProviderError(err) })
  } finally {
    if (geminiFile) await deleteVideoFile(geminiFile)
    for (const ext of Object.keys(MIME)) await fs.unlink(`${tmp}${ext}`).catch(() => {})
  }
}
