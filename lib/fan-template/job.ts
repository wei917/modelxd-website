// lib/fan-template/job.ts: one 風扇變裝 run (recipe.ts has the method). Kept
// the way 同款's make job is (lib/remake/make.ts): a JSON file in the user's
// folder (xcreate-user-files/<user>/fan/<id>/job.json, no migration), every
// picture and clip saved the moment it is made so a later pass resumes
// without paying twice, a lease so two passes never work at once, the
// reserve taken up front, list price for what was used, nothing if no video
// came out. The run is also a Library item (an xcreates row with the same
// id, `slots[0].options.fan`) that opens again at /xcreate?fan=<id>.

import type { SupabaseClient } from '@supabase/supabase-js'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateSpeech } from '@/lib/providers'
import type { ModelInfo } from '@/lib/providers/types'
import { debitCredits, grantCredits, getUserCredits, InsufficientCreditsError, formatCents } from '@/lib/credits'
import { ffmpegPath } from '@/lib/xcut-render'
import { B, STATUS_BUCKET, durationOf, get, mixMusic, put, run, service, signed, userPhoto } from '@/lib/remake/store'
import { picture, makeClip, lastFrame, type ProduceContext } from '@/lib/remake/engine/produce'
import { FAN_ASSET, firstCrossing, renderFanOverlay } from './fan'
import { finishOverlay, joinOpening, personSpan, pressTime } from './cut'
import {
  FAN_RESERVE_CENTS, HOLDING, OUTFITS, PLATE, PRESS_DEFAULT, REMOTE, ROLL, SHEET, SHEET_FRONT_ONLY, TIMING,
  fanMusicPrompt, outfitPrompt, startPrompt, stillClip, type FanRequest,
} from './recipe'

const LOG = '[fan:job]'
const LEASE_MS = 12 * 60_000
/** Pictures: GPT Image 2.5 (t4's), other makers when it refuses (OpenAI
 *  refuses some lying-down outfits at random, Oct 15-18). */
const MODELS = { pictures: ['gpt-image-2.5-sunburst', 'gemini-3.1-flash-image', 'qwen-image-3.0-pro'], video: 'wan3.0-video', videoBackup: 'happyhorse-1.1-i2v', music: 'music_v2_5', eyes: 'gemini-3.8-flash' }

export type FanStatus = 'sheet' | 'opening' | 'outfits' | 'clips' | 'finishing' | 'done' | 'failed'
export type FanJob = {
  v: 1
  id: string
  userId: string
  status: FanStatus
  createdAt: string
  updatedAt: string
  leaseUntil: number
  leaseBy: string
  request: FanRequest
  reservedCents: number
  spentUsd: number
  chargedCents?: number
  refundedCents?: number
  settled?: boolean
  assets: { sheet?: string; start?: string; roll?: string; holding?: string; remote?: string; keys: Record<string, string>; clips: Record<string, string>; music?: string; video?: string }
  /** Seconds into the remote clip when she presses (a model read it). */
  press?: number
  /** Where she lies across the frame, 0-1. */
  span?: [number, number]
  seconds?: number
  error?: string
}
export type FanView = {
  id: string; status: FanStatus; createdAt: string
  done: number; total: number
  reservedCents: number; spentCents: number; chargedCents: number | null
  video: string | null; download: string | null; seconds: number | null
  error: string | null
}
export class FanError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

const nowIso = () => new Date().toISOString()
const jobPath = (userId: string, id: string) => `${userId}/fan/${id}/job.json`
const assetPath = (job: FanJob, name: string) => `${job.userId}/fan/${job.id}/${name}`
export const isFanActive = (s: FanStatus) => s !== 'done' && s !== 'failed'

export async function loadFanJob(sb: SupabaseClient, userId: string, id: string): Promise<FanJob | null> {
  const { data } = await sb.storage.from(STATUS_BUCKET).download(jobPath(userId, id))
  if (!data) return null
  try { const j = JSON.parse(await data.text()); return j?.v === 1 ? j as FanJob : null } catch { return null }
}
async function saveJob(sb: SupabaseClient, job: FanJob) {
  job.updatedAt = nowIso()
  for (let attempt = 1; ; attempt++) {
    const { error } = await sb.storage.from(STATUS_BUCKET).upload(jobPath(job.userId, job.id), Buffer.from(JSON.stringify(job)), { contentType: 'text/plain', upsert: true })
    if (!error) return
    if (attempt >= 3) throw new Error(`could not save the job: ${error.message}`)
    await new Promise(r => setTimeout(r, 800 * attempt))
  }
}

/** sheet, start, roll, holding, remote, 4 outfits, 4 clips, music, video. */
const TOTAL = 15
function doneSteps(job: FanJob): number {
  const a = job.assets
  return [a.sheet, a.start, a.roll, a.holding, a.remote, a.music, a.video].filter(Boolean).length + Object.keys(a.keys).length + Object.keys(a.clips).length
    + (job.request.music.choice === 'none' && a.video ? 1 : 0)
}

export async function fanView(sb: SupabaseClient, job: FanJob): Promise<FanView> {
  const ready = !!job.assets.video && job.status === 'done'
  return {
    id: job.id, status: job.status, createdAt: job.createdAt,
    done: Math.min(TOTAL, doneSteps(job)), total: TOTAL,
    reservedCents: job.reservedCents, spentCents: Math.round(job.spentUsd * 100), chargedCents: job.chargedCents ?? null,
    video: ready ? await signed(sb, B.video, job.assets.video!).catch(() => null) : null,
    download: ready ? await signed(sb, B.video, job.assets.video!, 3600, `fan-outfit-${job.id.slice(0, 8)}.mp4`).catch(() => null) : null,
    seconds: job.seconds ?? null,
    error: job.error ?? null,
  }
}

// ── Start ─────────────────────────────────────────────────────────────────

/** Reserves the run, keeps it as a Library item and saves the job. The
 *  route checked the photos and the words. */
export async function startFan(userId: string, request: FanRequest, card: { title: string }): Promise<FanJob> {
  const sb = service()
  const id = crypto.randomUUID()
  const job: FanJob = {
    v: 1, id, userId, status: 'sheet', createdAt: nowIso(), updatedAt: nowIso(), leaseUntil: 0, leaseBy: '',
    request, reservedCents: FAN_RESERVE_CENTS, spentUsd: 0, assets: { keys: {}, clips: {} },
  }
  try {
    await debitCredits({
      userId, amountCents: FAN_RESERVE_CENTS, referenceType: 'xcreate_fan_reserve', referenceId: id,
      description: `XCreate 風扇變裝 reserve (${formatCents(FAN_RESERVE_CENTS)})`, metadata: { jobId: id },
    })
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      const balance = (await getUserCredits(userId))?.balance_cents ?? 0
      throw new FanError(402, 'insufficient_credits', { requiredCents: FAN_RESERVE_CENTS, balanceCents: balance })
    }
    throw e
  }
  try {
    const { error } = await sb.from('xcreates').insert({
      id, user_id: userId, mode: 'video', prompt: request.outfits.map(o => o.text).join(' / ').slice(0, 500), title: card.title.slice(0, 120),
      slots: [{ provider: 'alibaba', model_name: MODELS.video, name: 'Wan 3.0', text: null, isImage: false, isVideo: true, isAudio: false, cost: 0, error: null, errorRef: null, options: { fan: { v: 1, title: request.title } } }],
    })
    if (error) throw new Error(`row: ${error.message}`)
    await saveJob(sb, job)
  } catch (e) {
    await refund(job, FAN_RESERVE_CENTS, 'could not start').catch(() => {})
    throw e
  }
  console.log(`${LOG} ${id} started for ${userId.slice(0, 8)}, reserved ${FAN_RESERVE_CENTS}¢`)
  return job
}

async function refund(job: FanJob, cents: number, why: string) {
  if (cents <= 0) return
  await grantCredits({
    userId: job.userId, amountCents: cents, kind: 'refund', referenceType: 'xcreate_fan_refund', referenceId: job.id,
    description: `XCreate 風扇變裝 refund (${why})`, metadata: { jobId: job.id },
  })
}

// ── Drive ─────────────────────────────────────────────────────────────────

/** One pass: takes the lease, makes what is not made yet, settles at the end.
 *  Safe to call again at any time. */
export async function driveFan(userId: string, id: string): Promise<void> {
  const sb = service()
  const me = crypto.randomUUID()
  const job = await loadFanJob(sb, userId, id)
  if (!job || !isFanActive(job.status)) return
  if (job.leaseUntil > Date.now() && job.leaseBy !== me) return
  job.leaseUntil = Date.now() + LEASE_MS; job.leaseBy = me
  await saveJob(sb, job)
  try {
    await runFan(sb, job)
  } catch (e) {
    console.error(`${LOG} ${job.id} failed:`, e)
    job.status = 'failed'
    job.error = (e as Error).message?.slice(0, 300) || 'failed'
    await saveJob(sb, job).catch(() => {})
  }
  if (!isFanActive(job.status)) await settle(sb, job)
}

/** The method, step by step (recipe.ts); every piece is saved as it is made. */
export async function runFan(sb: SupabaseClient, job: FanJob) {
  const req = job.request
  const names = [...MODELS.pictures, MODELS.video, MODELS.videoBackup, MODELS.music, MODELS.eyes]
  const { data: rows } = await sb.from('ai_models').select('*').eq('enabled', true).in('model_name', names)
  const model = (name: string): ModelInfo => {
    const m = (rows ?? []).find((r: any) => r.model_name === name)
    if (!m) throw new Error(`model ${name} is not in the catalog`)
    return m as ModelInfo
  }
  const pictureModels = MODELS.pictures.map(n => (rows ?? []).find((r: any) => r.model_name === n) as ModelInfo | undefined).filter((m): m is ModelInfo => !!m)
  if (!pictureModels.length) throw new Error('no picture model is on')
  const spend = async (usd: number) => { job.spentUsd = Math.round((job.spentUsd + (usd || 0)) * 10000) / 10000; await saveJob(sb, job) }
  const ff = ffmpegPath()
  const ctx: ProduceContext = {
    userId: job.userId, surface: 'xcreate-fan', imageModel: pictureModels[0], videoModel: model(MODELS.video), speechModel: model(MODELS.video),
    videoBackup: (rows ?? []).find((r: any) => r.model_name === MODELS.videoBackup) as ModelInfo | undefined,
    sign: async (buffer: Buffer, name: string) => { const p = assetPath(job, `in/${name}`); await put(sb, B.image, p, buffer, 'image/jpeg'); return signed(sb, B.image, p) },
  }
  const jpeg = (b: Buffer) => ({ buffer: b, mediaType: 'image/jpeg' }) as any
  /** A saved picture, or make it, save it and count its price. */
  const pic = async (key: 'sheet' | 'start' | 'holding' | `key-${number}`, make: () => Promise<{ buffer: Buffer; cost: number }>): Promise<Buffer> => {
    const kept = key.startsWith('key-') ? job.assets.keys[key.slice(4)] : job.assets[key as 'sheet' | 'start' | 'holding']
    if (kept) return get(sb, B.image, kept)
    const r = await make()
    const p = await put(sb, B.image, assetPath(job, `${key}.jpg`), r.buffer, 'image/jpeg')
    if (key.startsWith('key-')) job.assets.keys[key.slice(4)] = p; else job.assets[key as 'sheet' | 'start' | 'holding'] = p
    await spend(r.cost)
    return r.buffer
  }
  const clip = async (key: 'roll' | 'remote' | `clip-${number}`, make: () => Promise<{ buffer: Buffer; cost: number }>): Promise<Buffer> => {
    const kept = key.startsWith('clip-') ? job.assets.clips[key.slice(5)] : job.assets[key as 'roll' | 'remote']
    if (kept) return get(sb, B.video, kept)
    const r = await make()
    const p = await put(sb, B.video, assetPath(job, `${key}.mp4`), r.buffer, 'video/mp4')
    if (key.startsWith('clip-')) job.assets.clips[key.slice(5)] = p; else job.assets[key as 'roll' | 'remote'] = p
    await spend(r.cost)
    return r.buffer
  }
  const outfitPhotos = await Promise.all(req.outfits.map(o => o.photo ? userPhoto(sb, o.photo) : Promise.resolve(null)))
  const shot = (n: number, s: { seconds: number; clip: string; sound: string }) => ({ n, clip: s.clip, sound: s.sound, clip_seconds: s.seconds }) as any

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `fan-${job.id.slice(0, 8)}-`))
  try {
    // 1. the sheet, from the user's photos
    const sheet = await pic('sheet', async () => {
      const photos = [await userPhoto(sb, req.front), ...(req.side ? [await userPhoto(sb, req.side)] : [])]
      return picture(pictureModels, req.side ? SHEET : SHEET_FRONT_ONLY, photos.map(jpeg), '16:9', ctx, 'high')
    })
    // 2. the user and outfit 1 on the set's sofa edge
    const start = await pic('start', async () => {
      const plate = await get(sb, PLATE.bucket, PLATE.path)
      return picture(pictureModels, startPrompt(req.outfits[0]), [plate, sheet, ...(outfitPhotos[0] ? [outfitPhotos[0]] : [])].map(jpeg), '9:16', ctx, 'high')
    })
    // 3. the opening: the roll (free), then the remote (first + last frame)
    job.status = 'opening'; await saveJob(sb, job)
    const roll = await clip('roll', () => makeClip(ctx, shot(0, ROLL), start, '9:16', { audio: true }))
    const landed = await lastFrame(ff, roll)
    const holding = await pic('holding', () => picture(pictureModels, HOLDING, [jpeg(landed)], '9:16', ctx, 'high'))
    const remote = await clip('remote', () => makeClip(ctx, shot(1, REMOTE), landed, '9:16', { lastFrame: holding, audio: true }))
    // 4. outfits 2-5: 2 is an edit of the remote frame, 3-5 edits of 2 (one
    //    base, so no edit drifts from a chain of edits)
    job.status = 'outfits'; await saveJob(sb, job)
    const keys = new Map<number, Buffer>()
    const outfitPic = (n: number, base: Buffer) => pic(`key-${n}`, () => picture(pictureModels, outfitPrompt(n, req.outfits[n - 1]), [base, sheet, ...(outfitPhotos[n - 1] ? [outfitPhotos[n - 1]!] : [])].map(jpeg), '9:16', ctx, 'high'))
    keys.set(2, await outfitPic(2, holding))
    await Promise.all([3, 4, 5].map(async (n, i) => { await new Promise(r => setTimeout(r, i * 1500)); keys.set(n, await outfitPic(n, keys.get(2)!)) }))
    // 5. still clips: the same picture as first and last frame (the camera cannot move)
    job.status = 'clips'; await saveJob(sb, job)
    const clips = new Map<number, Buffer>()
    await Promise.all([2, 3, 4, 5].map(async (n, i) => {
      await new Promise(r => setTimeout(r, i * 2000))
      clips.set(n, await clip(`clip-${n}`, () => makeClip(ctx, shot(n, stillClip(n)), keys.get(n)!, '9:16', { lastFrame: keys.get(n)!, audio: true })))
    }))

    // 6. the finish
    job.status = 'finishing'; await saveJob(sb, job)
    const file = async (name: string, buf: Buffer) => { const f = path.join(tmp, name); await fs.writeFile(f, buf); return f }
    const rollF = await file('roll.mp4', roll), remoteF = await file('remote.mp4', remote)
    const clipF = await Promise.all([2, 3, 4, 5].map(n => file(`clip-${n}.mp4`, clips.get(n)!)))
    if (job.press == null) {
      const r = await pressTime(model(MODELS.eyes), ff, remoteF, job.userId, PRESS_DEFAULT)
      job.press = r.t; await spend(r.cost)
    }
    if (!job.span) {
      const r = await personSpan(model(MODELS.eyes), [2, 3, 4, 5].map(n => keys.get(n)!), job.userId)
      job.span = [r.x0, r.x1]; await spend(r.cost)
    }
    const openingF = path.join(tmp, 'opening.mp4')
    await joinOpening(ff, rollF, remoteF, openingF)
    // The clock: the fan starts at the press; a blade passes every step.
    const { step, tail, lead, rollEnd, remoteFrom } = TIMING
    const period = 3 * step
    const fanStart = rollEnd + Math.max(0, job.press - remoteFrom)
    const first = fanStart + firstCrossing(period)
    const cross = [0, 1, 2, 3].map(k => first + k * step)
    const end = cross[3] + tail
    const bounds = [0, ...cross, end]
    const takeStart = [0, ...cross.map(c => Math.max(0, c - lead))]
    const W = 720, H = 1280
    const [x0, x1] = job.span
    const hubX = Math.round(W * (x0 + x1) / 2)
    const bladeWidth = Math.round(Math.max(W * 0.34, Math.min(W * 0.6, W * (x1 - x0) * 1.08)))
    const takes = [openingF, ...clipF]
    const overlay = path.join(tmp, 'fan.mp4')
    await renderFanOverlay({
      out: overlay, ffmpeg: ff, fan: await get(sb, FAN_ASSET.bucket, FAN_ASSET.path), W, H, duration: end, hub: [hubX, -150], bladeWidth,
      start: fanStart, period, takes: takes.map((video, k) => ({ video, start: takeStart[k] })),
    })
    const cut = path.join(tmp, 'cut.mp4')
    const font = path.join(process.cwd(), 'public/fonts/NotoSansTC-Regular.ttf')
    await finishOverlay(ff, font, overlay, takes, bounds, takeStart, req.outfits.map(o => [req.title, o.text].filter(Boolean).join('\n')), cut)
    console.log(`${LOG} ${job.id} press ${job.press}s, fan ${fanStart.toFixed(2)}s, changes ${cross.map(c => c.toFixed(2)).join(' ')}, hub ${hubX}, blade ${bladeWidth}px`)

    // 7. the music
    if (req.music.choice !== 'none' && !job.assets.music) {
      let buf: Buffer
      if (req.music.choice === 'mine' && req.music.track) {
        const src = path.join(tmp, `mine${path.extname(req.music.track).slice(0, 6) || '.bin'}`), mp3 = path.join(tmp, 'mine.mp3')
        await fs.writeFile(src, await get(sb, B.userAudio, req.music.track))
        await run(ff, ['-v', 'error', '-y', '-i', src, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', mp3])
        buf = await fs.readFile(mp3)
      } else {
        const r: any = await generateSpeech(model(MODELS.music), fanMusicPrompt(req.music.style, Math.ceil(end), [fanStart, ...cross]), { seconds: Math.ceil(end) } as any, { userId: job.userId, surface: 'xcreate-fan' } as any)
        buf = r.buffer
        await spend(r.cost ?? 0)
      }
      job.assets.music = await put(sb, B.audio, assetPath(job, 'music.mp3'), buf, 'audio/mpeg')
      await saveJob(sb, job)
    }
    let final = cut
    if (job.assets.music) {
      const m = await file('music.mp3', await get(sb, B.audio, job.assets.music))
      final = path.join(tmp, 'final.mp4')
      await mixMusic(ff, cut, m, final)
    }
    job.seconds = Math.round(((await durationOf(ff, final)) || end) * 10) / 10
    job.assets.video = await put(sb, B.video, assetPath(job, 'fan-outfit.mp4'), await fs.readFile(final), 'video/mp4')
    await saveJob(sb, job)

    // 8. on the Library item
    await putOnRow(sb, job)
    job.status = 'done'
    await saveJob(sb, job)
    console.log(`${LOG} ${job.id} done: ${job.seconds}s, $${job.spentUsd.toFixed(2)}`)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

async function putOnRow(sb: SupabaseClient, job: FanJob) {
  const { data: row } = await sb.from('xcreates').select('id, slots').eq('id', job.id).maybeSingle()
  if (!row) return
  const slots = (row.slots as any[]) ?? []
  const first = slots[0] ?? {}
  const next = [{
    ...first, text: await signed(sb, B.video, job.assets.video!), isVideo: true, isImage: false, durationSeconds: job.seconds ?? null, cost: job.spentUsd,
    options: { ...first.options, fan: { ...first.options?.fan, made: { path: job.assets.video, at: nowIso(), seconds: job.seconds } } },
  }, ...slots.slice(1)]
  const { error } = await sb.from('xcreates').update({ slots: next }).eq('id', job.id).eq('user_id', job.userId)
  if (error) console.warn(`${LOG} ${job.id} Library update failed: ${error.message}`)
}

/** List price for what was used, never past the reserve, nothing when no
 *  video came out; only the pass that creates the marker moves money. */
async function settle(sb: SupabaseClient, job: FanJob) {
  if (job.settled) return
  const marker = `${job.userId}/fan/${job.id}/settled.txt`
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
