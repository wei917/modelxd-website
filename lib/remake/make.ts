// lib/remake/make.ts: making a 同款 remake (phase 2; owner, Oct 17: "can you
// build the entire tab page and let me try it?"). One job per read, kept as a
// JSON file next to the read (xcreate-user-files/<user>/remake/<row>/make.json),
// so no migration. The job is resumable: every picture, clip and track is
// saved the moment it is made, and a later drive pass picks up where the last
// one stopped without paying twice. A lease in the file keeps two passes from
// working on one job at once.
//
// The steps, and the rules the fan video taught (Oct 16-17):
//   plan     Claude maps the original's shots onto the remake (engine/plan.ts).
//   pictures a sheet per character; each shot's first frame from words, or, on
//            the same set as an earlier shot, as an EDIT of that shot's end
//            frame, so the room and camera cannot drift ("the original video
//            doesn't change scene at all").
//   clips    a still shot gets the same picture as first and last frame (its
//            camera cannot move); a moving shot starts from its first frame
//            and runs free (a pinned landing made people glide, "they float").
//   music    an original track in the read's style, tuned by the page's
//            sliders, or the user's own track, or none.
//   cut      when the original's changes are a ceiling fan's blade passes, our
//            own fan does them at one steady speed (lib/remake/fan.ts);
//            otherwise the shots are joined with the original's transitions.
//   save     the video goes on the read's Library item; the user pays what
//            was used at list price, never more than the reserve, nothing if
//            no video came out.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { generateSpeech, streamText } from '@/lib/providers'
import type { ModelInfo } from '@/lib/providers/types'
import { debitCredits, grantCredits, getUserCredits, InsufficientCreditsError, formatCents } from '@/lib/credits'
import { ffmpegPath } from '@/lib/xcut-render'
import { planRemake } from './engine/director'
import { sameSet, stretch, type RemakePlan, type RemakeRequest } from './engine/plan'
import { makeSheet, makeKeyframe, makeSetKeyframe, makeClip, makeVoice, lastFrame, toAspect, type Aspect } from './engine/produce'
import { assemble } from './engine/edit'
import { FAN_ASSET, firstCrossing, renderFanOverlay } from './fan'
import { musicPrompt, styleFromRead, SUNG_LANGUAGE } from './music'
import { estimateRemakeCents, type Breakdown, type Shot, type CastChoice, type MusicChoice, type MusicTune, type PlaceChoice, type RemakeLook, type ThingChoice, type VoiceChoice } from './config'
import type { SavedRemake } from './saved'

const run = promisify(execFile)
const LOG = '[remake:make]'

/** A media file's length in seconds, from ffmpeg itself (ffmpeg-static ships no ffprobe). */
async function durationOf(ff: string, file: string): Promise<number> {
  const err = await run(ff, ['-hide_banner', '-i', file]).then(() => '', (e: any) => String(e?.stderr ?? ''))
  const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}
const STATUS_BUCKET = 'xcreate-user-files'
const B = { image: 'xcreate-ai-images', video: 'xcreate-ai-videos', audio: 'xcreate-ai-audio', userImage: 'xcreate-user-images', userAudio: 'xcreate-user-files' }
/** The tested set (fan runs t3 and t4, Oct 17): Grok draws sheets and first
 *  frames from words, GPT Image 2.5 does the same-set edits. */
const MODELS = { director: 'claude-opus-5-5', sheet: 'grok-imagine-image-2.0', keyframe: 'grok-imagine-image-2.0', edit: 'gpt-image-2.5-sunburst', video: 'wan3.0-video', voice: 'gemini-3.8-flash-tts', music: 'music_v2_5', eyes: 'gemini-3.8-flash' }
/** A drive pass gives up its lease after this long; the next pass resumes. */
const LEASE_MS = 12 * 60_000

export type MakeStatus = 'planning' | 'pictures' | 'clips' | 'music' | 'cutting' | 'done' | 'failed'
type Pick<C extends string> = { choice: C; text: string; photo?: string }
export type MakeRequest = {
  from: number
  seconds: number
  cast: Record<string, Pick<CastChoice> & { consent?: boolean }>
  things: Record<string, Pick<ThingChoice>>
  places: Record<string, Pick<PlaceChoice>>
  theme: string
  setting: string
  look: RemakeLook
  language: string
  /** The user's product photo (their upload folder), if any. */
  product?: string
  music: { choice: MusicChoice; tune: MusicTune; track?: string }
  /** By speaker (a line's `who`): the AI voice (the default), the user's own
   *  recording (their upload folder, laid in at the speaker's first line), or none. */
  voices: Record<string, { choice: VoiceChoice; recording?: string }>
  /** On-screen text, the original's → the user's; one left out is rewritten for the theme. */
  texts: Record<string, string>
}
export type MakeJob = {
  v: 1
  id: string
  rowId: string
  userId: string
  status: MakeStatus
  createdAt: string
  updatedAt: string
  leaseUntil: number
  leaseBy: string
  request: MakeRequest
  reservedCents: number
  spentUsd: number
  chargedCents?: number
  refundedCents?: number
  overlay: 'fan' | null
  plan?: RemakePlan
  assets: { sheets: Record<string, string>; keys: Record<string, string>; clips: Record<string, string>; voices: Record<string, string>; music?: string; video?: string }
  /** Seconds of the finished remake. */
  seconds?: number
  error?: string
  settled?: boolean
}
export type MakeView = {
  id: string; status: MakeStatus; createdAt: string
  done: number; total: number
  reservedCents: number; spentCents: number; chargedCents: number | null
  video: string | null; seconds: number | null
  /** The same file as an attachment (Supabase's `download`): the only save
   *  that works on a phone, where a cross-origin `download` is ignored. */
  download: string | null
  error: string | null
}

export class MakeError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

export const service = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
const nowIso = () => new Date().toISOString()
const jobPath = (userId: string, rowId: string) => `${userId}/remake/${rowId}/make.json`
const assetPath = (job: MakeJob, name: string) => `${job.userId}/remake/${job.rowId}/${job.id}/${name}`

export async function loadJob(sb: SupabaseClient, userId: string, rowId: string): Promise<MakeJob | null> {
  const { data } = await sb.storage.from(STATUS_BUCKET).download(jobPath(userId, rowId))
  if (!data) return null
  try { const j = JSON.parse(await data.text()); return j?.v === 1 ? j as MakeJob : null } catch { return null }
}
async function saveJob(sb: SupabaseClient, job: MakeJob) {
  job.updatedAt = nowIso()
  for (let attempt = 1; ; attempt++) {
    const { error } = await sb.storage.from(STATUS_BUCKET).upload(jobPath(job.userId, job.rowId), Buffer.from(JSON.stringify(job)), { contentType: 'text/plain', upsert: true })
    if (!error) return
    if (attempt >= 3) throw new Error(`could not save the job: ${error.message}`)
    await new Promise(r => setTimeout(r, 800 * attempt))
  }
}
async function put(sb: SupabaseClient, bucket: string, p: string, buf: Buffer, type: string) {
  for (let attempt = 1; ; attempt++) {
    const { error } = await sb.storage.from(bucket).upload(p, buf, { contentType: type, upsert: true })
    if (!error) return p
    if (attempt >= 3) throw new Error(`upload ${p}: ${error.message}`)
    await new Promise(r => setTimeout(r, 800 * attempt))
  }
}
async function get(sb: SupabaseClient, bucket: string, p: string): Promise<Buffer> {
  const { data, error } = await sb.storage.from(bucket).download(p)
  if (error || !data) throw new Error(`download ${p}: ${error?.message ?? 'missing'}`)
  return Buffer.from(await data.arrayBuffer())
}
/** A user's photo as the JPEG the picture models are told it is: upright
 *  (a phone's EXIF turn applied) and at most 2048 px. */
async function userPhoto(sb: SupabaseClient, p: string): Promise<Buffer> {
  return sharp(await get(sb, B.userImage, p)).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
}
async function signed(sb: SupabaseClient, bucket: string, p: string, seconds = 3600, download?: string) {
  const { data } = await sb.storage.from(bucket).createSignedUrl(p, seconds, download ? { download } : undefined)
  if (!data?.signedUrl) throw new Error(`could not sign ${p}`)
  return data.signedUrl
}

/** The original's changes are a ceiling fan's blade passes (the fan trend):
 *  most cuts are wipes and the read names a fan or its blades. */
export function fanOverlay(b: Breakdown): boolean {
  const wipes = b.shots.slice(1).filter(s => /wipe/i.test(s.transition_in)).length
  const mentions = /fan|blade|扇/i.test(b.shots.map(s => `${s.action} ${s.where}`).join(' ') + ` ${b.summary} ${b.hook}`)
  return mentions && b.shots.length > 1 && wipes >= Math.ceil((b.shots.length - 1) / 2)
}

/** How many saved pieces the job will have when done (for the progress bar). */
function totalSteps(job: MakeJob): number {
  if (!job.plan) return 1
  const p = job.plan
  const sheets = p.characters.filter(c => c.source !== 'extra').length
  const keys = p.shots.filter(s => !s.continues).length
  return 1 + sheets + keys + p.shots.length + p.voices.length + (job.request.music.choice === 'none' ? 0 : 1) + 1
}
function doneSteps(job: MakeJob): number {
  if (!job.plan) return 0
  const a = job.assets
  return 1 + Object.keys(a.sheets).length + Object.keys(a.keys).length + Object.keys(a.clips).length + Object.keys(a.voices).length + (a.music ? 1 : 0) + (a.video ? 1 : 0)
}

export async function makeView(sb: SupabaseClient, job: MakeJob): Promise<MakeView> {
  const ready = !!job.assets.video && job.status === 'done'
  return {
    id: job.id, status: job.status, createdAt: job.createdAt,
    done: doneSteps(job), total: totalSteps(job),
    reservedCents: job.reservedCents, spentCents: Math.round(job.spentUsd * 100),
    chargedCents: job.chargedCents ?? null,
    video: ready ? await signed(sb, B.video, job.assets.video!).catch(() => null) : null,
    seconds: job.seconds ?? null,
    download: ready ? await signed(sb, B.video, job.assets.video!, 3600, `remake-${job.id.slice(0, 8)}.mp4`).catch(() => null) : null,
    error: job.error ?? null,
  }
}
export const isActive = (s: MakeStatus) => s !== 'done' && s !== 'failed'

/** In the fan cut a take starts this long before its change (under the blade)
 *  and runs this long past the next one. */
const LEAD = 0.6, TAIL = 0.2

/** The cut's clock: where each shot starts on the remake (then its end), where
 *  each shot's take starts, and how long each clip must be. With the fan the
 *  changes come at one steady fan speed, the first where the original's first
 *  change was (the fan starts just before it), and each take covers its blade
 *  pass at both ends; otherwise the shots keep the original's lengths. */
export function cutTiming(shots: Shot[], overlay: 'fan' | null) {
  const lens = shots.map(s => Math.max(0.1, s.t1 - s.t0))
  if (overlay === 'fan' && shots.length > 1) {
    const first = shots[1].t0
    const step = (shots[shots.length - 1].t0 - first) / Math.max(1, shots.length - 2) || lens[1]
    const period = 3 * Math.max(1.6, step)
    const cross = firstCrossing(period)
    const start = Math.max(0.3, first - cross)
    const bounds = [0, ...shots.slice(1).map((_, k) => start + cross + k * (period / 3))]
    bounds.push(bounds[bounds.length - 1] + Math.max(1.5, lens[lens.length - 1]))
    const takeStart = shots.map((_, k) => k === 0 ? 0 : Math.max(0, bounds[k] - LEAD))
    const need = takeStart.map((t0, k) => bounds[k + 1] + (k < shots.length - 1 ? TAIL : 0) - t0)
    return { bounds, takeStart, need, fan: { start, period } as { start: number; period: number } | null }
  }
  const bounds = [0]
  for (const l of lens) bounds.push(bounds[bounds.length - 1] + l)
  return { bounds, takeStart: bounds.slice(0, -1), need: lens, fan: null as { start: number; period: number } | null }
}

// ── Start ─────────────────────────────────────────────────────────────────

export async function startMake(userId: string, rowId: string, request: MakeRequest): Promise<MakeJob> {
  const sb = service()
  const saved = await loadSaved(sb, userId, rowId)
  const existing = await loadJob(sb, userId, rowId)
  if (existing && isActive(existing.status)) return existing
  const seconds = Math.max(1, Math.min(request.seconds, Math.round(saved.breakdown.duration - request.from)))
  const reservedCents = estimateRemakeCents(seconds)
  const job: MakeJob = {
    v: 1, id: crypto.randomUUID(), rowId, userId, status: 'planning', createdAt: nowIso(), updatedAt: nowIso(),
    leaseUntil: 0, leaseBy: '', request: { ...request, seconds }, reservedCents, spentUsd: 0,
    overlay: fanOverlay(saved.breakdown) ? 'fan' : null,
    assets: { sheets: {}, keys: {}, clips: {}, voices: {} },
  }
  // The whole quote is reserved first, as every XCreate run: the wallet is the
  // authority, and what is not used comes back when the remake settles.
  try {
    await debitCredits({
      userId, amountCents: reservedCents, referenceType: 'xcreate_remake_reserve', referenceId: job.id,
      description: `XCreate 同款 reserve (${formatCents(reservedCents)} for ${seconds}s)`,
      metadata: { jobId: job.id, rowId, seconds },
    })
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      const balance = (await getUserCredits(userId))?.balance_cents ?? 0
      throw new MakeError(402, 'insufficient_credits', { requiredCents: reservedCents, balanceCents: balance })
    }
    throw e
  }
  try { await saveJob(sb, job) } catch (e) {
    await refund(job, reservedCents, 'could not start').catch(() => {})
    throw e
  }
  console.log(`${LOG} ${job.id} started for ${rowId}: ${seconds}s, reserved ${reservedCents}¢, overlay ${job.overlay ?? 'none'}`)
  return job
}

async function loadSaved(sb: SupabaseClient, userId: string, rowId: string): Promise<SavedRemake> {
  const { data: row } = await sb.from('xcreates').select('id, user_id, slots, deleted_at').eq('id', rowId).maybeSingle()
  const saved = (row?.slots as any[])?.[0]?.options?.remake as SavedRemake | undefined
  if (!row || row.user_id !== userId || row.deleted_at || !saved?.breakdown) throw new MakeError(404, 'not_found')
  return saved
}

async function refund(job: MakeJob, cents: number, why: string) {
  if (cents <= 0) return
  await grantCredits({
    userId: job.userId, amountCents: cents, kind: 'refund', referenceType: 'xcreate_remake_refund', referenceId: job.id,
    description: `XCreate 同款 refund (${why})`, metadata: { jobId: job.id, rowId: job.rowId },
  })
}

// ── Drive ─────────────────────────────────────────────────────────────────

/** One drive pass: takes the lease, runs every step that is not done yet,
 *  and settles at the end. Safe to call again at any time. */
export async function driveMake(userId: string, rowId: string): Promise<void> {
  const sb = service()
  const me = crypto.randomUUID()
  let job = await loadJob(sb, userId, rowId)
  if (!job || !isActive(job.status)) return
  if (job.leaseUntil > Date.now() && job.leaseBy !== me) return
  job.leaseUntil = Date.now() + LEASE_MS; job.leaseBy = me
  await saveJob(sb, job)
  try {
    await runSteps(sb, job)
  } catch (e) {
    console.error(`${LOG} ${job.id} failed:`, e)
    job.status = 'failed'
    job.error = (e as Error).message?.slice(0, 300) || 'failed'
    await saveJob(sb, job).catch(() => {})
  }
  if (!isActive(job.status)) await settle(sb, job)
}

async function runSteps(sb: SupabaseClient, job: MakeJob) {
  const saved = await loadSaved(sb, job.userId, job.rowId)
  const breakdown = saved.breakdown
  const req = job.request
  const { data: rows } = await sb.from('ai_models').select('*').in('model_name', Object.values(MODELS))
  const model = (name: string): ModelInfo => {
    const m = (rows ?? []).find((r: any) => r.model_name === name)
    if (!m) throw new Error(`model ${name} is not in the catalog`)
    return m as ModelInfo
  }
  const spend = async (usd: number) => { job.spentUsd = Math.round((job.spentUsd + (usd || 0)) * 10000) / 10000; await saveJob(sb, job) }
  const aspect: Aspect = toAspect(breakdown.aspect)
  const ff = ffmpegPath()
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `remake-${job.id.slice(0, 8)}-`))
  try {
    const shots = stretch(breakdown, req.from, req.seconds)
    // ── plan
    if (!job.plan) {
      const castSwap = Object.fromEntries(Object.entries(req.cast).map(([id, p]) => [id, { choice: p.choice, text: p.text, photo: !!p.photo }]))
      const plannerReq: RemakeRequest = {
        breakdown, from: req.from, seconds: req.seconds, cast: castSwap,
        theme: thingsAndPlaces(req, breakdown, req.theme), setting: req.setting, look: req.look, language: req.language,
        product: !!productPath(req, breakdown), aspect, overlay: job.overlay ?? undefined,
      }
      const r = await planRemake(plannerReq, model(MODELS.director), job.userId)
      job.plan = r.plan
      // The overlay's shots after the opening are still by rule, and its cut
      // carries each take's own sound and the music, never voices.
      if (job.overlay === 'fan') {
        const { need } = cutTiming(shots, 'fan')
        job.plan.shots.forEach((s, i) => {
          if (i > 0) s.still = true
          if (need[i]) s.clip_seconds = Math.min(15, Math.max(s.clip_seconds, Math.ceil(need[i] - 0.05)))
        })
        job.plan.voices = []
      }
      // The page's voice and text choices, applied by code over the plan: a
      // speaker set to none or to the user's recording gets no AI voice, and
      // a text the user wrote replaces the planner's.
      job.plan.voices = job.plan.voices.filter(v => (req.voices?.[v.who]?.choice ?? 'ai') === 'ai')
      job.plan.shots.forEach((s, i) => { const own = req.texts?.[shots[i]?.text.trim() ?? '']?.trim(); if (own) s.text = own })
      job.status = 'pictures'
      await spend(r.cost)
    }
    const plan = job.plan!
    const sets = sameSet(shots)
    const ctx: any = {
      userId: job.userId, surface: 'xcreate-remake',
      imageModel: model(MODELS.keyframe), editModel: model(MODELS.edit), videoModel: model(MODELS.video), speechModel: model(MODELS.voice),
      sign: async (buffer: Buffer, name: string) => { const p = assetPath(job, `in/${name}`); await put(sb, B.image, p, buffer, 'image/jpeg'); return signed(sb, B.image, p) },
    }

    // ── sheets
    for (const c of plan.characters.filter(c => c.source !== 'extra')) {
      if (job.assets.sheets[c.id]) continue
      const photoPath = req.cast[c.id]?.choice === 'photo' ? req.cast[c.id]?.photo : undefined
      const photo = photoPath ? await userPhoto(sb, photoPath) : undefined
      const r = await makeSheet({ ...ctx, imageModel: model(MODELS.sheet) }, plan.look, c, photo)
      job.assets.sheets[c.id] = await put(sb, B.image, assetPath(job, `sheet-${c.id}.jpg`), r.buffer, 'image/jpeg')
      await spend(r.cost)
    }
    const sheets = new Map<string, Buffer>()
    for (const [id, p] of Object.entries(job.assets.sheets)) sheets.set(id, await get(sb, B.image, p))
    const productAt = productPath(req, breakdown)
    const product = productAt ? await userPhoto(sb, productAt) : null
    const placePhotos = new Map<string, Buffer>()
    for (const [id, p] of Object.entries(req.places)) if (p.choice === 'photo' && p.photo) placePhotos.set(id, await userPhoto(sb, p.photo))

    // ── first frames and clips, in order of what each needs
    const keyBuf = new Map<number, Buffer>()
    const clipBuf = new Map<number, Buffer>()
    const endFrame = async (i: number): Promise<Buffer> => {
      const s = plan.shots[i]
      if (s.still && !s.continues) return keyFrame(i)
      return lastFrame(ff, await clip(i))
    }
    const keyFrame = async (i: number): Promise<Buffer> => {
      if (keyBuf.has(i)) return keyBuf.get(i)!
      const s = plan.shots[i]
      let buf: Buffer
      if (s.continues && i > 0) buf = await lastFrame(ff, await clip(i - 1))
      else if (job.assets.keys[s.n]) buf = await get(sb, B.image, job.assets.keys[s.n])
      else {
        const setOf = sets[i]
        let r: { buffer: Buffer; cost: number }
        if (setOf != null) {
          // The base is where the set last changed: the end frame of the latest
          // earlier shot on it that MOVED (a roll, a walk), else the set's first
          // frame. Still shots in between end where they start, so every edit
          // comes from the same picture and none drifts from a chain of edits.
          let k = i - 1
          while (k > setOf && !(sets[k] === setOf && !plan.shots[k].still)) k--
          r = await makeSetKeyframe(ctx, plan, s, await endFrame(k), sheets, aspect)
        } else r = await makeKeyframe(ctx, plan, s, sheets, product, aspect, placePhotos.get(shots[i]?.place ?? '') ?? null)
        job.assets.keys[s.n] = await put(sb, B.image, assetPath(job, `key-${s.n}.jpg`), r.buffer, 'image/jpeg')
        await spend(r.cost)
        buf = r.buffer
      }
      keyBuf.set(i, buf)
      return buf
    }
    const clipPromises = new Map<number, Promise<Buffer>>()
    const clip = (i: number): Promise<Buffer> => {
      if (!clipPromises.has(i)) clipPromises.set(i, (async () => {
        if (clipBuf.has(i)) return clipBuf.get(i)!
        const s = plan.shots[i]
        let buf: Buffer
        if (job.assets.clips[s.n]) buf = await get(sb, B.video, job.assets.clips[s.n])
        else {
          const first = await keyFrame(i)
          job.status = 'clips'
          const r = await makeClip(ctx, s, first, aspect, { lastFrame: s.still ? first : undefined, audio: true })
          job.assets.clips[s.n] = await put(sb, B.video, assetPath(job, `clip-${s.n}.mp4`), r.buffer, 'video/mp4')
          await spend(r.cost)
          buf = r.buffer
        }
        clipBuf.set(i, buf)
        return buf
      })())
      return clipPromises.get(i)!
    }
    // Up to three at a time; a shot waits only for what its first frame needs.
    const queue = plan.shots.map((_, i) => i)
    await Promise.all(Array.from({ length: 3 }, async () => { for (let i = queue.shift(); i !== undefined; i = queue.shift()) await clip(i) }))

    // ── voices
    for (const [k, v] of plan.voices.entries()) {
      if (job.assets.voices[k]) continue
      const r = await makeVoice(ctx, v)
      job.assets.voices[k] = await put(sb, B.audio, assetPath(job, `voice-${k}.mp3`), r.buffer, 'audio/mpeg')
      await spend(r.cost)
    }

    // ── the cut's timing: the overlay evens the changes out to one fan speed
    const { bounds, takeStart, fan } = cutTiming(shots, job.overlay)
    const total = bounds[bounds.length - 1]

    // ── music
    if (req.music.choice !== 'none' && !job.assets.music) {
      job.status = 'music'
      let buf: Buffer
      if (req.music.choice === 'mine') {
        if (!req.music.track) throw new Error('no music track')
        // Whatever the user picked (m4a, wav, flac...), as the mp3 the mix expects.
        const src = path.join(tmp, `mine${path.extname(req.music.track).slice(0, 6) || '.bin'}`), mp3 = path.join(tmp, 'mine.mp3')
        await fs.writeFile(src, await get(sb, B.userAudio, req.music.track))
        await run(ff, ['-v', 'error', '-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', mp3])
        buf = await fs.readFile(mp3)
      } else {
        const style = styleFromRead(breakdown.music)
        const prompt = musicPrompt(style, Math.ceil(total), {
          instrumental: true, tune: req.music.choice === 'tune' ? req.music.tune : null,
          accents: bounds.slice(1, -1), language: SUNG_LANGUAGE[req.language] ?? 'English',
        })
        const r: any = await generateSpeech(model(MODELS.music), prompt, { seconds: Math.ceil(total) } as any, { userId: job.userId, surface: 'xcreate-remake' } as any)
        buf = r.buffer
        await spend(r.cost ?? 0)
      }
      job.assets.music = await put(sb, B.audio, assetPath(job, 'music.mp3'), buf, 'audio/mpeg')
      await saveJob(sb, job)
    }

    // ── the cut
    if (!job.assets.video) {
      job.status = 'cutting'
      await saveJob(sb, job)
      const clipFiles: string[] = []
      for (const [i, s] of plan.shots.entries()) {
        const f = path.join(tmp, `clip-${i}.mp4`)
        await fs.writeFile(f, clipBuf.get(i) ?? await get(sb, B.video, job.assets.clips[s.n]))
        clipFiles.push(f)
      }
      const font = path.join(process.cwd(), 'public/fonts/NotoSansTC-Regular.ttf')
      const cut = path.join(tmp, 'cut.mp4')
      if (fan) {
        const box = await personSpan(model(MODELS.eyes), [...keyBuf.values()].slice(1, 5), job.userId)
        await spend(box.cost)
        const W = aspect === '9:16' || aspect === '3:4' ? 720 : 1280, H = Math.round(W * (aspect === '9:16' ? 16 / 9 : aspect === '3:4' ? 4 / 3 : aspect === '1:1' ? 1 : aspect === '4:3' ? 0.75 : 9 / 16))
        const hubX = Math.round(W * (box.x0 + box.x1) / 2)
        const bladeWidth = Math.round(Math.max(W * 0.34, Math.min(W * 0.6, W * (box.x1 - box.x0) * 1.08)))
        const fanPic = await get(sb, FAN_ASSET.bucket, FAN_ASSET.path)
        const overlay = path.join(tmp, 'fan.mp4')
        await renderFanOverlay({
          out: overlay, ffmpeg: ff, fan: fanPic, W, H, duration: total, hub: [hubX, -150], bladeWidth,
          start: fan.start, period: fan.period,
          takes: clipFiles.map((f, k) => ({ video: f, start: takeStart[k] })),
        })
        await finishOverlay(ff, font, overlay, clipFiles, bounds, takeStart, plan.shots.map(s => s.text), cut)
        console.log(`${LOG} ${job.id} fan hub x ${hubX}, blade ${bladeWidth}px, start ${fan.start.toFixed(2)}s, period ${fan.period.toFixed(2)}s`)
      } else {
        const voices: { path: string; t: number }[] = []
        for (const [k, v] of plan.voices.entries()) {
          const f = path.join(tmp, `voice-${k}.mp3`)
          await fs.writeFile(f, await get(sb, B.audio, job.assets.voices[k]))
          voices.push({ path: f, t: v.t })
        }
        // The user's own recordings, each at its speaker's first line in the stretch.
        for (const [k, [who, v]] of Object.entries(req.voices ?? {}).entries()) {
          if (v.choice !== 'mine' || !v.recording) continue
          const line = breakdown.lines.find(l => l.who === who && l.t >= req.from && l.t < req.from + req.seconds)
          if (!line) continue
          const f = path.join(tmp, `mine-voice-${k}${path.extname(v.recording).slice(0, 6) || '.bin'}`)
          await fs.writeFile(f, await get(sb, B.userAudio, v.recording))
          voices.push({ path: f, t: Math.round((line.t - req.from) * 10) / 10 })
        }
        // The stretch's own clock (0 = its start) is the remake's.
        await assemble({ ffmpeg: ff, font, aspect, shots: plan.shots.map((s, i) => ({ ...s, t0: shots[i]?.t0 ?? s.t0, t1: shots[i]?.t1 ?? s.t1 })), clips: clipFiles, voices, out: cut })
      }
      let final = cut
      if (job.assets.music) {
        const m = path.join(tmp, 'music.mp3')
        await fs.writeFile(m, await get(sb, B.audio, job.assets.music))
        final = path.join(tmp, 'final.mp4')
        await mixMusic(ff, cut, m, final)
      }
      job.seconds = Math.round(((await durationOf(ff, final)) || total) * 10) / 10
      job.assets.video = await put(sb, B.video, assetPath(job, 'remake.mp4'), await fs.readFile(final), 'video/mp4')
      await saveJob(sb, job)
    }

    // ── save on the read's Library item
    await putOnRow(sb, job)
    job.status = 'done'
    await saveJob(sb, job)
    console.log(`${LOG} ${job.id} done: ${job.seconds}s, $${job.spentUsd.toFixed(2)}`)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/** The one product photo the pictures take: the page's own product photo, else
 *  a product swapped for a photo, else any thing swapped for one. */
function productPath(req: MakeRequest, b: Breakdown): string | undefined {
  const photos = Object.entries(req.things).filter(([, p]) => p.choice === 'photo' && p.photo)
  return req.product
    ?? photos.find(([id]) => b.things.find(t => t.id === id)?.kind === 'product')?.[1].photo
    ?? photos[0]?.[1].photo
}

/** The things and places the user swapped, said in words the planner reads
 *  with the theme (the planner's own fields are cast, theme and setting). */
function thingsAndPlaces(req: MakeRequest, b: Breakdown, theme: string): string {
  const parts: string[] = []
  for (const t of b.things) {
    const p = req.things[t.id]
    if (!p || p.choice === 'keep') continue
    parts.push(p.choice === 'remove' ? `Leave out ${t.name}.` : p.choice === 'describe' && p.text ? `Replace ${t.name} with: ${p.text}.` : p.choice === 'photo' ? `Replace ${t.name} with the user's product photo.` : '')
  }
  for (const x of b.places) {
    const p = req.places[x.id]
    if (!p || p.choice === 'keep') continue
    if (p.choice === 'describe' && p.text) parts.push(`Set "${x.name}" in: ${p.text}.`)
    if (p.choice === 'photo' && p.photo) parts.push(`Set "${x.name}" in the place in the user's photo (it is given to the picture model).`)
  }
  return [theme, ...parts].filter(Boolean).join(' ')
}

/** Where the person lies across the frame, left to right (0-1), over the
 *  given pictures: the fan's hub goes above the middle and its blade is made
 *  just wider than the widest of them. A model reads it (a model's job). */
async function personSpan(model: ModelInfo, pictures: Buffer[], userId: string): Promise<{ x0: number; x1: number; cost: number }> {
  if (!pictures.length) return { x0: 0.3, x1: 0.7, cost: 0 }
  let text = '', cost = 0
  await new Promise<void>((resolve, reject) => {
    streamText(model, [{ role: 'user', content: `These ${pictures.length} pictures are the same top-down shot of one person lying down, in different clothes. For each picture give the box around the whole person (head, hair, arms, hands, clothes, shoes): [ymin, xmin, ymax, xmax] on a 0-1000 scale. Return JSON only: {"boxes": [[ymin, xmin, ymax, xmax], ...]}` }],
      { onDelta: d => { text += d }, onDone: r => { cost = r.cost; resolve() }, onError: m => reject(new Error(m)) },
      pictures.map(b => ({ buffer: b, mediaType: 'image/jpeg' }) as any), { userId, surface: 'xcreate-remake' } as any)
  })
  try {
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    const boxes: number[][] = (j.boxes ?? []).filter((b: any) => Array.isArray(b) && b.length === 4)
    if (!boxes.length) throw new Error('no boxes')
    return { x0: Math.min(...boxes.map(b => b[1])) / 1000, x1: Math.max(...boxes.map(b => b[3])) / 1000, cost }
  } catch { return { x0: 0.3, x1: 0.7, cost } }
}

/** The overlay's captions and sound: each take's own room sound while its
 *  outfit is on screen, joined at the changes; the shot's text drawn on top
 *  (a first line at the top, the second at the bottom), switching under the
 *  blade with half-open windows so two captions never share a frame. */
export async function finishOverlay(ff: string, font: string, video: string, clips: string[], bounds: number[], takeStart: number[], texts: string[], out: string) {
  const dir = path.dirname(out)
  const inputs: string[] = []
  const parts: string[] = []
  for (let k = 0; k < clips.length; k++) {
    inputs.push('-i', clips[k])
    const len = bounds[k + 1] - bounds[k] + (k < clips.length - 1 ? TAIL : 0)
    const from = bounds[k] - takeStart[k]
    parts.push(`[${k}:a]atrim=${from.toFixed(2)}:${(from + len).toFixed(2)},asetpts=PTS-STARTPTS,apad=whole_dur=${len.toFixed(2)},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${k}]`)
  }
  let acc = 'a0'
  for (let k = 1; k < clips.length; k++) { parts.push(`[${acc}][a${k}]acrossfade=d=0.2[x${k}]`); acc = `x${k}` }
  const sound = path.join(dir, 'sound.m4a')
  await run(ff, ['-v', 'error', '-y', ...inputs, '-filter_complex', parts.join(';'), '-map', `[${acc}]`, '-c:a', 'aac', '-b:a', '160k', sound], { maxBuffer: 32 * 1024 * 1024 })
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, '\u2019').replace(/:/g, '\\:').replace(/%/g, '\\%')
  const draws: string[] = []
  for (let k = 0; k < texts.length; k++) {
    const lines = String(texts[k] ?? '').split('\n').map(x => x.trim()).filter(Boolean)
    const on = `enable='gte(t,${bounds[k].toFixed(3)})*lt(t,${bounds[k + 1].toFixed(3)})'`
    const [top, bottom] = lines.length > 1 ? lines : [null, lines[0]]
    if (top) { const f = path.join(dir, `cap-${k}-t.txt`); await fs.writeFile(f, top.slice(0, 40)); draws.push(`drawtext=fontfile='${esc(font)}':textfile='${esc(f)}':x=(w-tw)/2:y=150:fontsize=40:fontcolor=white:borderw=3:bordercolor=black@0.7:${on}`) }
    if (bottom) { const f = path.join(dir, `cap-${k}-b.txt`); await fs.writeFile(f, bottom.slice(0, 40)); draws.push(`drawtext=fontfile='${esc(font)}':textfile='${esc(f)}':x=(w-tw)/2:y=h-150:fontsize=44:fontcolor=white:borderw=3:bordercolor=black@0.7:${on}`) }
  }
  await run(ff, ['-v', 'error', '-y', '-i', video, '-i', sound, ...(draws.length ? ['-vf', draws.join(',')] : []), '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out], { maxBuffer: 32 * 1024 * 1024 })
}

/** The music at -16 LUFS over the video's own sound, which sits 14 dB under
 *  it; a short fade at the end. */
export async function mixMusic(ff: string, video: string, music: string, out: string) {
  const d = await durationOf(ff, video)
  const fade = d > 2 ? `,afade=t=out:st=${(d - 0.8).toFixed(2)}:d=0.8` : ''
  await run(ff, ['-v', 'error', '-y', '-i', video, '-i', music, '-filter_complex',
    `[1:a]atrim=0:${d.toFixed(2)},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11${fade},aformat=sample_rates=48000:channel_layouts=stereo[m];[0:a]volume=-14dB,aformat=sample_rates=48000:channel_layouts=stereo[r];[m][r]amix=inputs=2:normalize=0:duration=first[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { maxBuffer: 32 * 1024 * 1024 })
}

/** The video on the read's Library item: the card becomes the video, and the
 *  read keeps a note of the job that made it. */
async function putOnRow(sb: SupabaseClient, job: MakeJob) {
  const { data: row } = await sb.from('xcreates').select('id, slots').eq('id', job.rowId).maybeSingle()
  if (!row) return
  const slots = (row.slots as any[]) ?? []
  const url = await signed(sb, B.video, job.assets.video!)
  const first = slots[0] ?? {}
  const next = [{
    ...first, text: url, isVideo: true, isImage: false, durationSeconds: job.seconds ?? null,
    options: { ...first.options, remake: { ...first.options?.remake, made: { job: job.id, path: job.assets.video, at: nowIso(), seconds: job.seconds } } },
  }, ...slots.slice(1)]
  const { error } = await sb.from('xcreates').update({ slots: next }).eq('id', job.rowId).eq('user_id', job.userId)
  if (error) console.warn(`${LOG} ${job.id} Library update failed: ${error.message}`)
}

/** List price for what was used, never past the reserve, nothing when no
 *  video came out; the rest comes back. Only the pass that creates the settle
 *  marker moves money, so two passes can never refund twice. */
async function settle(sb: SupabaseClient, job: MakeJob) {
  if (job.settled) return
  const marker = `${job.userId}/remake/${job.rowId}/${job.id}/settled.txt`
  const { error: claimed } = await sb.storage.from(STATUS_BUCKET).upload(marker, Buffer.from(nowIso()), { contentType: 'text/plain', upsert: false })
  if (claimed) return
  const ok = job.status === 'done' && !!job.assets.video
  const used = Math.round(job.spentUsd * 100)
  const charged = ok ? Math.min(used, job.reservedCents) : 0
  const back = job.reservedCents - charged
  try { await refund(job, back, ok ? `used ${formatCents(charged)} of ${formatCents(job.reservedCents)}` : 'no video was made') }
  catch (e) { console.error(`${LOG} ${job.id} REFUND FAILED, owed ${back}¢:`, e) }
  if (used > job.reservedCents && ok) console.warn(`${LOG} ${job.id} used ${used}¢ against a ${job.reservedCents}¢ reserve; the house covers ${used - job.reservedCents}¢`)
  job.chargedCents = charged; job.refundedCents = back; job.settled = true
  await saveJob(sb, job).catch(() => {})
}
