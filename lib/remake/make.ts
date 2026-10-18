// lib/remake/make.ts: making a 同款 remake (phase 2; owner, Oct 17: "can you
// build the entire tab page and let me try it?"). One job per read, kept as a
// JSON file next to the read (xcreate-user-files/<user>/remake/<row>/make.json),
// so no migration. The job is resumable: every picture, clip and track is
// saved the moment it is made, and a later drive pass picks up where the last
// one stopped without paying twice. A lease in the file keeps two passes from
// working on one job at once.
//
// The steps, and the rules the first remakes taught (Oct 16-18):
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
//   cut      the shots joined with the original's transitions. 同款 remakes
//            any video and need not be exact (owner, Oct 18: "同款 doesn't
//            need to generate exact what I want. but template needs to be more
//            accurate"): the fan outfit change, with our own fan at one steady
//            speed, is its own template (claude/fan-template), not a case here.
//   refusal  a picture or clip one maker's filter refuses goes to another
//            maker's model, and a picture all of them refuse is toned down,
//            instead of stopping the remake (engine/produce.ts).
//   save     the video goes on the read's Library item; the user pays what
//            was used at list price, never more than the reserve, nothing if
//            no video came out.

import type { SupabaseClient } from '@supabase/supabase-js'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateSpeech } from '@/lib/providers'
import type { ModelInfo } from '@/lib/providers/types'
import { debitCredits, grantCredits, getUserCredits, InsufficientCreditsError, formatCents } from '@/lib/credits'
import { ffmpegPath } from '@/lib/xcut-render'
import { planRemake } from './engine/director'
import { sameSet, stretch, type RemakePlan, type RemakeRequest } from './engine/plan'
import { makeSheet, makeKeyframe, makeSetKeyframe, makeClip, makeVoice, lastFrame, toAspect, type Aspect } from './engine/produce'
import { assemble } from './engine/edit'
import { musicPrompt, styleFromRead, SUNG_LANGUAGE } from './music'
import { estimateRemakeCents, type Breakdown, type CastChoice, type MusicChoice, type MusicTune, type PlaceChoice, type RemakeLook, type ThingChoice, type VoiceChoice } from './config'
import type { SavedRemake } from './saved'
import { B, STATUS_BUCKET, durationOf, get, mixMusic, put, run, service, signed, userPhoto } from './store'

export { service, mixMusic }
const LOG = '[remake:make]'

/** The tested set (runs t3 and t4, Oct 17): Grok draws sheets and first
 *  frames from words, GPT Image 2.5 does the same-set edits. The backups are
 *  other makers' models for what one refuses (Oct 18). */
const MODELS = { director: 'claude-opus-5-5', sheet: 'grok-imagine-image-2.0', keyframe: 'grok-imagine-image-2.0', edit: 'gpt-image-2.5-sunburst', video: 'wan3.0-video', voice: 'gemini-3.8-flash-tts', music: 'music_v2_5' }
const BACKUPS = { image: ['gemini-3.1-flash-image', 'gpt-image-2.5-sunburst'], edit: ['gemini-3.1-flash-image', 'qwen-image-3.0-pro'], video: 'happyhorse-1.1-i2v' }
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
  console.log(`${LOG} ${job.id} started for ${rowId}: ${seconds}s, reserved ${reservedCents}¢`)
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
  // A settled job is finished business, whatever its status says (Oct 18: a
  // failed job's late clip set it back to 'clips', and a page load revived it).
  if (!job || job.settled || !isActive(job.status)) return
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
  const { data: rows } = await sb.from('ai_models').select('*').eq('enabled', true).in('model_name', [...Object.values(MODELS), ...BACKUPS.image, ...BACKUPS.edit, BACKUPS.video])
  const model = (name: string): ModelInfo => {
    const m = (rows ?? []).find((r: any) => r.model_name === name)
    if (!m) throw new Error(`model ${name} is not in the catalog`)
    return m as ModelInfo
  }
  /** Backups that are in the catalog and switched on; a missing one is skipped. */
  const backups = (names: string[]) => names.map(n => (rows ?? []).find((r: any) => r.model_name === n) as ModelInfo | undefined).filter((m): m is ModelInfo => !!m)
  // After a failure, work still in flight (a clip in another branch) may
  // finish: it is counted but never saved, so it cannot bring the job back.
  const spend = async (usd: number) => { job.spentUsd = Math.round((job.spentUsd + (usd || 0)) * 10000) / 10000; if (job.status !== 'failed') await saveJob(sb, job) }
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
        product: !!productPath(req, breakdown), aspect,
      }
      const r = await planRemake(plannerReq, model(MODELS.director), job.userId)
      job.plan = r.plan
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
      imageBackups: backups(BACKUPS.image), editBackups: backups(BACKUPS.edit), videoBackup: backups([BACKUPS.video])[0],
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
          if (job.status !== 'failed') job.status = 'clips'
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

    // ── the cut's clock: the shots keep the original's lengths
    const bounds = [0]
    for (const s of shots) bounds.push(bounds[bounds.length - 1] + Math.max(0.1, s.t1 - s.t0))
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
