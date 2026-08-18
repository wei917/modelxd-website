// app/api/xdirector/transcribe/route.ts
// Turn an uploaded song into timestamped lyrics for the director (owner,
// Aug 10: "I should be able to upload the music or lyric to generate mv").
//
// The director (Claude) cannot hear audio, so an mp3 attached in XDirect is
// useless on its own. This transcribes it first — Fun-ASR (Mandarin-strong,
// the same engine XCreate's Audio → Text uses) — and hands back the
// [mm:ss] lyric lines the chat injects into the conversation. HOUSE-PAID,
// like the director's own turns: an MV brief shouldn't nickel-and-dime, and
// Fun-ASR is ~$0.002/min. The actual video generations still bill normally.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'
import * as providers from '@/lib/providers'

const LOG = '[xdirector:transcribe]'

const serviceClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

async function requireUser() {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { bucket, storagePath, mediaType } = await req.json().catch(() => ({}))
  if (typeof bucket !== 'string' || typeof storagePath !== 'string') {
    return Response.json({ error: 'bucket and storagePath required' }, { status: 400 })
  }

  const sb = serviceClient()

  // The transcription engine: prefer Fun-ASR (songs + Mandarin), fall back to
  // Whisper. Read from the catalog so pricing/enabled stay data-driven.
  const { data: models } = await sb.from('ai_models')
    .select('id, provider, model_name, display_name, model_pricing, modes')
    .contains('modes', ['audio_to_text']).eq('enabled', true)
  const pool = models ?? []
  const model = pool.find((m: any) => m.model_name === 'fun-asr')
    ?? pool.find((m: any) => m.provider === 'openai')
    ?? pool[0]
  if (!model) return Response.json({ error: 'No transcription model is available.' }, { status: 503 })

  // DashScope fetches by URL; Whisper reads bytes. Provide both.
  const { data: signed } = await sb.storage.from(bucket).createSignedUrl(storagePath, 3600)
  let buffer: Buffer | undefined
  if (model.provider === 'openai') {
    const { data: blob } = await sb.storage.from(bucket).download(storagePath)
    if (blob) buffer = Buffer.from(await blob.arrayBuffer())
  }

  const audio: any = { url: signed?.signedUrl, mediaType: mediaType || 'audio/mpeg', ...(buffer ? { buffer } : { buffer: Buffer.alloc(0) }) }
  try {
    const r = await providers.transcribeAudio(model as any, audio, null, { userId: user.id })
    console.log(`${LOG} ${model.model_name} → ${r.segments.length} lines, ${r.durationSeconds.toFixed(0)}s (house-paid $${r.cost.toFixed(4)})`)
    return Response.json({ text: r.text, segments: r.segments, durationSeconds: r.durationSeconds, model: model.display_name })
  } catch (err: any) {
    console.error(`${LOG} failed:`, err?.message)
    return Response.json({ error: err?.message ?? 'Transcription failed' }, { status: 502 })
  }
}
