// app/api/xcharacter/route.ts — Character CRUD (owner design, Aug 7).
// The builder's API: create/update/delete/list characters. The chat turn
// and memory live in ./chat — this route never calls a model.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'
import { assertFeature } from '@/lib/features'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

const MAX_CHARACTERS = 20   // per user — a roster, not a farm

const clean = (v: any, max: number) => String(v ?? '').trim().slice(0, max)

export async function POST(req: Request) {
  const gate = await assertFeature('xtalk')
  if (gate) return gate
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  if (body.action === 'list') {
    // select('*'), not a column list: naming voice/voice_desc here would
    // 500 the whole roster until migration 77 is applied — and dev + prod
    // share one database. '*' returns whatever columns exist today.
    const { data } = await svc().from('x_characters')
      .select('*')
      .eq('user_id', user.id).order('created_at', { ascending: false })
    return Response.json({ characters: data ?? [] })
  }

  if (body.action === 'create' || body.action === 'update') {
    const name = clean(body.name, 60)
    const persona = clean(body.persona, 4000)
    const appearance = clean(body.appearance, 1000)
    const avatarPath = clean(body.avatarPath, 300) || null
    if (body.action === 'create' && !name) {
      return Response.json({ error: 'A character needs a name' }, { status: 400 })
    }
    // The model must exist, be enabled, and speak text. thinking is clamped
    // against what the model declares — same rule as every seat on the site.
    const { data: model } = await svc().from('ai_models')
      .select('id, display_name, output_modalities, output_config')
      .eq('id', String(body.modelId ?? '')).eq('enabled', true).maybeSingle()
    if (!model || !(model.output_modalities ?? []).includes('text')) {
      return Response.json({ error: 'Pick a text model for your character' }, { status: 400 })
    }
    const levels = model.output_config?.text?.thinking_levels ?? []
    const thinking = typeof body.thinking === 'string' && levels.includes(body.thinking) ? body.thinking : null
    // Search is clamped against the model's declared capabilities — same
    // rule as every other seat on the site.
    const caps = model.output_config?.text?.capabilities ?? []
    const search = body.search === true && caps.includes('web_search')
    // Photo gallery: bucket paths only, owned-folder shape enforced above
    // at upload time by storage RLS; here we just cap the count.
    const photos = (Array.isArray(body.photos) ? body.photos : [])
      .map((p: any) => clean(p, 300)).filter(Boolean).slice(0, 12)
    // Voice: a preset name or a designed-voice id (see ./tts). voice_desc
    // present ⇒ designed; it steers synthesis to the voice-design model.
    const voice = clean(body.voice, 120) || null
    const voiceDesc = voice ? (clean(body.voiceDesc, 500) || null) : null
    const VOICE_RATES = [0.75, 1, 1.25, 1.5]
    const voiceRate = VOICE_RATES.includes(Number(body.voiceRate)) ? Number(body.voiceRate) : 1

    // Until migration 77 lands, the voice columns don't exist — and dev +
    // prod share one database, so a save must never break over them. Try
    // with voice; if the column is what failed, retry without it.
    const dropVoice = (row: Record<string, any>) => {
      const { voice: _v, voice_desc: _d, voice_rate: _r, ...rest } = row
      return rest
    }

    if (body.action === 'create') {
      const { count } = await svc().from('x_characters')
        .select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      if ((count ?? 0) >= MAX_CHARACTERS) {
        return Response.json({ error: `Character limit reached (${MAX_CHARACTERS})` }, { status: 400 })
      }
      const row = {
        user_id: user.id, name, persona, appearance,
        avatar_path: avatarPath, model_id: model.id, thinking, search, photos,
        voice, voice_desc: voiceDesc, voice_rate: voiceRate,
      }
      let ins = await svc().from('x_characters').insert(row).select('id').single()
      if (ins.error && /voice/i.test(ins.error.message)) {
        ins = await svc().from('x_characters').insert(dropVoice(row)).select('id').single()
      }
      if (ins.error || !ins.data) {
        console.warn('[xcharacter] create failed:', ins.error?.message)
        return Response.json({ error: 'Could not create — is migration 75 applied?' }, { status: 503 })
      }
      return Response.json({ id: ins.data.id })
    }

    // update — owner-scoped by the WHERE; name keeps its old value if blank.
    const patch: Record<string, any> = { persona, appearance, model_id: model.id, thinking, search, photos, voice, voice_desc: voiceDesc, voice_rate: voiceRate }
    if (name) patch.name = name
    if (avatarPath) patch.avatar_path = avatarPath
    let upd = await svc().from('x_characters')
      .update(patch).eq('id', String(body.id ?? '')).eq('user_id', user.id)
    if (upd.error && /voice/i.test(upd.error.message)) {
      upd = await svc().from('x_characters')
        .update(dropVoice(patch)).eq('id', String(body.id ?? '')).eq('user_id', user.id)
    }
    if (upd.error) return Response.json({ error: 'Update failed' }, { status: 500 })
    return Response.json({ ok: true })
  }

  if (body.action === 'delete') {
    // Cascade wipes messages and memory — the character's whole life.
    const { error } = await svc().from('x_characters')
      .delete().eq('id', String(body.id ?? '')).eq('user_id', user.id)
    if (error) return Response.json({ error: 'Delete failed' }, { status: 500 })
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
