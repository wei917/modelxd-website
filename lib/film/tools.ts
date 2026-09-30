// lib/film/tools.ts — what the film director's three custom tools do.
// Server-only. Each call generates through lib/providers (so it is logged in
// provider_calls against the viewer and priced at list), stores the file in
// the usual output bucket and answers the agent with a 24-hour download URL.
//
// Nothing here fetches a URL the agent supplied: a first frame is named, and
// the image is read back out of our own storage.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage, generateVideo, generateSpeech } from '@/lib/providers'
import { estimateCost } from '@/lib/providers/pricing'
import { sanitizeProviderError } from '@/lib/provider-errors'
import { FILM_VOICES, FILM_STYLED_VOICES } from './agent'

export const FILM_TOOL_MODELS = {
  image: 'gpt-image-2',
  t2v: 'happyhorse-1.1-t2v',
  i2v: 'happyhorse-1.1-i2v',
  speech: 'speech-2.8-turbo',
  /** The voices that take a delivery instruction: Taiwanese Mandarin comes
   *  from here (owner picked Gemini told 「用台灣腔的國語說，溫暖親切。」, Sep 29;
   *  MiniMax has no Taiwan-accented voice among its 332). Optional: without
   *  the row, speak falls back to MiniMax only. */
  speechStyled: 'gemini-3.8-flash-tts',
} as const

/** Per-film ceilings on top of the money, so a confused agent stops early. */
export const FILM_TOOL_LIMITS = { generate_image: 16, generate_video: 12, speak: 30 } as const
export type FilmTool = keyof typeof FILM_TOOL_LIMITS
export const isFilmTool = (v: unknown): v is FilmTool =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(FILM_TOOL_LIMITS, v)

const IMAGE_SIZE: Record<string, string> = { '9:16': '1152x2048', '16:9': '2048x1152', '1:1': '1024x1024' }
const URL_TTL = 60 * 60 * 24

export type FilmModels = { image: any; t2v: any; i2v: any; speech: any; speechStyled: any | null }

export async function loadFilmModels(sb: SupabaseClient): Promise<FilmModels> {
  const names = Object.values(FILM_TOOL_MODELS)
  const { data, error } = await sb.from('ai_models').select('*').in('model_name', names).eq('enabled', true)
  if (error) throw new Error(`film models: ${error.message}`)
  const by = (name: string) => {
    const row = (data ?? []).find((r: any) => r.model_name === name)
    if (!row) throw new Error(`film models: ${name} is missing or disabled`)
    return row
  }
  return {
    image: by(FILM_TOOL_MODELS.image), t2v: by(FILM_TOOL_MODELS.t2v), i2v: by(FILM_TOOL_MODELS.i2v), speech: by(FILM_TOOL_MODELS.speech),
    speechStyled: (data ?? []).find((r: any) => r.model_name === FILM_TOOL_MODELS.speechStyled) ?? null,
  }
}

/** The file-safe form of the agent's asset name. */
export const assetName = (v: unknown) =>
  String(v ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'asset'

const clampSeconds = (v: unknown) => Math.max(3, Math.min(10, Math.round(Number(v) || 5)))
/** A speak call goes to the styled voices when it names one or asks for a style. */
const wantsStyledVoice = (input: any) =>
  (typeof input?.voice === 'string' && (FILM_STYLED_VOICES as readonly string[]).includes(input.voice))
  || (typeof input?.style === 'string' && input.style.trim().length > 0)
const aspectOf = (v: unknown) => (typeof v === 'string' && IMAGE_SIZE[v] ? v : '9:16')

/** List price of a call before it runs, in cents (rounded up). */
export function estimateToolCents(tool: FilmTool, input: any, models: FilmModels): number {
  let usd = 0
  if (tool === 'generate_image') usd = estimateCost(models.image, 'image', { quality: 'medium', size: IMAGE_SIZE[aspectOf(input?.aspect)] })
  else if (tool === 'generate_video') usd = estimateCost(models.t2v, 'video', { resolution: '720p', seconds: clampSeconds(input?.seconds) })
  else usd = estimateCost((wantsStyledVoice(input) && models.speechStyled) || models.speech, 'audio', { promptChars: String(input?.text ?? '').slice(0, 600).length })
  return Math.max(1, Math.ceil(usd * 100))
}

export type FilmToolOutcome = {
  status: 'done' | 'failed'
  text: string
  costUsd: number
  bucket?: string
  path?: string
}

type Film = { id: string; user_id: string }

async function store(sb: SupabaseClient, film: Film, bucket: string, name: string, buffer: Buffer, mediaType: string) {
  const ext = (mediaType.split('/')[1] ?? 'bin').replace('mpeg', 'mp3').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '')
  // First folder = the owner: the buckets' read policy (supabase/storage.sql)
  // lets a user sign only what sits under their own id.
  const path = `${film.user_id}/films/${film.id}/${name}-${Date.now().toString(36)}.${ext}`
  let error: { message: string } | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    ;({ error } = await sb.storage.from(bucket).upload(path, buffer, { contentType: mediaType, upsert: true }))
    if (!error) break
  }
  if (error) throw new Error(`upload failed: ${error.message}`)
  const { data } = await sb.storage.from(bucket).createSignedUrl(path, URL_TTL)
  if (!data?.signedUrl) throw new Error('could not sign the file')
  return { path, url: data.signedUrl, file: `${name}.${ext}` }
}

/** Run one call. `left` is the generation budget after this call's
 *  estimate, for the agent's planning. Errors come back as text for the
 *  agent (it can adapt), never as a throw. */
export async function runFilmTool(
  sb: SupabaseClient, film: Film, tool: FilmTool, input: any, models: FilmModels, leftAfter: () => Promise<string>,
): Promise<FilmToolOutcome> {
  const name = assetName(input?.name)
  const context = { userId: film.user_id }
  try {
    if (tool === 'generate_image') {
      const aspect = aspectOf(input?.aspect)
      const size = IMAGE_SIZE[aspect]
      const prompt = String(input?.prompt ?? '').slice(0, 4000)
      if (!prompt.trim()) return { status: 'failed', costUsd: 0, text: 'generate_image needs a prompt.' }
      const r = await generateImage(models.image, prompt, 'medium', size, [], null, null, context)
      const s = await store(sb, film, 'xcreate-ai-images', name, r.buffer, r.mediaType)
      return {
        status: 'done', costUsd: r.cost ?? 0, bucket: 'xcreate-ai-images', path: s.path,
        text: `Image "${name}" ready (${size}). Use first_frame: "${name}" to animate it.\nDownload (valid 24h): curl -sL -o ${s.file} "${s.url}"\n${await leftAfter()}`,
      }
    }
    if (tool === 'generate_video') {
      const seconds = clampSeconds(input?.seconds)
      const prompt = String(input?.prompt ?? '').slice(0, 2000)
      if (!prompt.trim()) return { status: 'failed', costUsd: 0, text: 'generate_video needs a prompt.' }
      const attachments: any[] = []
      const frameName = typeof input?.first_frame === 'string' && input.first_frame.trim() ? assetName(input.first_frame) : null
      if (frameName) {
        const { data: frame } = await sb.from('xcreate_film_calls')
          .select('bucket, path').eq('film_id', film.id).eq('tool', 'generate_image').eq('name', frameName).eq('status', 'done')
          .order('finished_at', { ascending: false }).limit(1).maybeSingle()
        if (!frame?.path) return { status: 'failed', costUsd: 0, text: `No image named "${frameName}" in this film. first_frame takes the name of an image you made with generate_image.` }
        const { data: blob, error } = await sb.storage.from(frame.bucket).download(frame.path)
        if (error || !blob) return { status: 'failed', costUsd: 0, text: `Could not read the image "${frameName}". Try again or go without first_frame.` }
        const { data: signed } = await sb.storage.from(frame.bucket).createSignedUrl(frame.path, 60 * 60)
        attachments.push({ buffer: Buffer.from(await blob.arrayBuffer()), mediaType: blob.type || 'image/png', url: signed?.signedUrl, port: 'first_frame' })
      }
      const model = frameName ? models.i2v : models.t2v
      const r = await generateVideo(model, prompt, '720p', seconds, attachments, undefined, context, {
        aspect_ratio: frameName ? null : aspectOf(input?.aspect),
        mode: frameName ? 'image_to_video' : 'text_to_video',
        generate_audio: false,
        watermark: false,
      })
      const s = await store(sb, film, 'xcreate-ai-videos', name, r.buffer, r.mediaType)
      return {
        status: 'done', costUsd: r.cost ?? 0, bucket: 'xcreate-ai-videos', path: s.path,
        text: `Clip "${name}" ready (${r.durationSeconds ?? seconds}s, 720p, no sound).\nDownload (valid 24h): curl -sL -o ${s.file} "${s.url}"\n${await leftAfter()}`,
      }
    }
    // speak
    const text = String(input?.text ?? '').slice(0, 600)
    if (!text.trim()) return { status: 'failed', costUsd: 0, text: 'speak needs text.' }
    let r
    if (wantsStyledVoice(input)) {
      const styledVoices = FILM_STYLED_VOICES.join(', ')
      if (!models.speechStyled) return { status: 'failed', costUsd: 0, text: 'The voices that take a style are unavailable right now. Use a MiniMax voice without style.' }
      const offered: string[] = (models.speechStyled.output_config?.audio?.voices ?? []).map((v: any) => v.id)
      const voice = typeof input?.voice === 'string' && offered.includes(input.voice) ? input.voice : null
      if (!voice) return { status: 'failed', costUsd: 0, text: `style works only with these voices: ${styledVoices} (women: Leda, Kore, Aoede, Zephyr; men: Puck, Charon, Fenrir, Orus). Pick one of them, or drop style to use a MiniMax voice.` }
      const style = typeof input?.style === 'string' && input.style.trim() ? input.style.trim().slice(0, 300) : null
      r = await generateSpeech(models.speechStyled, text, { voice, style, format: 'mp3' }, context)
    } else {
      const offered: string[] = (models.speech.output_config?.audio?.voices ?? []).map((v: any) => v.id)
      const voice = typeof input?.voice === 'string' && offered.includes(input.voice) ? input.voice : null
      if (!voice) return { status: 'failed', costUsd: 0, text: `Pick a voice from: ${(offered.length ? offered : FILM_VOICES).join(', ')}, or one of ${FILM_STYLED_VOICES.join(', ')} with a style.` }
      r = await generateSpeech(models.speech, text, { voice, format: 'mp3' }, context)
    }
    const s = await store(sb, film, 'xcreate-ai-audio', name, r.buffer, r.mediaType)
    return {
      status: 'done', costUsd: r.cost ?? 0, bucket: 'xcreate-ai-audio', path: s.path,
      text: `Voice "${name}" ready (${r.durationSeconds != null ? r.durationSeconds.toFixed(1) + 's' : 'duration unknown'}).\nDownload (valid 24h): curl -sL -o ${s.file} "${s.url}"\n${await leftAfter()}`,
    }
  } catch (e) {
    return { status: 'failed', costUsd: 0, text: `The ${tool} call failed: ${sanitizeProviderError(e).slice(0, 400)}. Nothing was charged for it.\n${await leftAfter()}` }
  }
}
