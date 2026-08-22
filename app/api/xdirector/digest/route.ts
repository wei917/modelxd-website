// app/api/xdirector/digest/route.ts
// Turn an uploaded story — a PDF, a .txt, or pasted text, of ANY length —
// into the STORY BIBLE the director storyboards from (owner, Aug 22: "no
// matter how long the story is, we should always summarize it and use the
// summary as input … 10 scenes most … only keep the most important
// things").
//
// The director never sees the document: a whole novel does not fit a chat
// turn, and even a short story is better adapted from its beats than
// illustrated page by page. So, like the song transcription next door,
// this route reads the file server-side and hands the chat a piece of TEXT
// to inject. Two modes:
//   mode=bible   (Story template)  → map/reduce digest → bible text + JSON
//   mode=extract (other templates) → the first 8000 characters, like a .txt
// HOUSE-PAID, like transcription and the director's own turns.

export const runtime = 'nodejs'
export const maxDuration = 300   // a novel is ~20 windows; 8 in flight → ~2-3 minutes incl. the reduce

import { createClient } from '@supabase/supabase-js'
import { extractPdfText } from '@/lib/pdf-extract'
import { MAX_DOC_CHARS } from '@/lib/story-digest'
import { pickDigestModels, digestDocument } from '@/lib/story-digest-run'

const LOG = '[xdirector:digest]'
const EXTRACT_CHARS = 8_000   // the same window a lyric .txt gets in the chat

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

  const body = await req.json().catch(() => ({}))
  const mode  = body?.mode === 'extract' ? 'extract' : 'bible'
  const lang  = typeof body?.lang === 'string' ? body.lang : undefined
  const focus = typeof body?.focus === 'string' && body.focus.trim() ? body.focus.trim().slice(0, 200) : undefined

  // ── The text: pasted, or read out of storage ───────────────────────────
  let text = ''
  let source = 'pasted story'
  if (typeof body?.text === 'string' && body.text.trim()) {
    text = body.text.slice(0, MAX_DOC_CHARS)
  } else {
    const { bucket, storagePath, mediaType, fileName } = body ?? {}
    if (typeof bucket !== 'string' || typeof storagePath !== 'string') {
      return Response.json({ error: 'text, or bucket and storagePath, required' }, { status: 400 })
    }
    source = typeof fileName === 'string' ? fileName : storagePath
    const { data: blob, error } = await serviceClient().storage.from(bucket).download(storagePath)
    if (error || !blob) return Response.json({ error: `Could not read the file: ${error?.message ?? 'not found'}` }, { status: 404 })
    const buffer = Buffer.from(await blob.arrayBuffer())
    const isPdf = mediaType === 'application/pdf' || /\.pdf$/i.test(source)
    try {
      text = isPdf
        ? await extractPdfText(buffer, { maxChars: MAX_DOC_CHARS })
        // .txt — UTF-8 (BOM stripped). Legacy Big5/Shift-JIS files decode to
        // mojibake; the bible bubble makes that visible and the user re-saves.
        : buffer.toString('utf8').replace(/^﻿/, '').slice(0, MAX_DOC_CHARS)
    } catch (err: any) {
      console.error(`${LOG} extraction failed for ${source}:`, err?.message)
      return Response.json({ error: 'Could not extract text from the file.' }, { status: 422 })
    }
  }
  text = text.trim()
  if (text.length < 20) {
    return Response.json({ error: 'No readable text in the document (a scanned PDF has no text layer).' }, { status: 422 })
  }

  if (mode === 'extract') {
    return Response.json({ text: text.slice(0, EXTRACT_CHARS), chars: text.length, model: 'extract', windows: 1 })
  }

  // ── The digest ──────────────────────────────────────────────────────────
  const { data: rows } = await serviceClient().from('ai_models').select('*').eq('enabled', true)
  const models = pickDigestModels((rows ?? []) as any[])
  if (!models) return Response.json({ error: 'No text model is available for the digest.' }, { status: 503 })

  try {
    const r = await digestDocument(text, { lang, focus, userId: user.id, models })
    console.log(`${LOG} ${source}: ${r.chars} chars, ${r.windows} window(s) → bible by ${r.model}`)
    return Response.json({ text: r.text, bible: r.bible, model: r.model, chars: r.chars, windows: r.windows })
  } catch (err: any) {
    console.error(`${LOG} failed for ${source}:`, err?.message)
    return Response.json({ error: err?.message ?? 'Digest failed' }, { status: 502 })
  }
}
