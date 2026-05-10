// app/api/admin/models/route.ts
// Admin-only: upsert a single ai_models row.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'
import { assertAdmin } from '@/lib/admin'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

interface InRow {
  id?:                string
  provider:           string
  model_name:         string
  display_name:       string
  enabled?:           boolean
  is_popular?:        boolean
  released_at?:       string | null
  modes?:             string[]
  input_modalities:   string[]
  output_modalities:  string[]
  tags?:              string[]
  model_pricing?:     any
  input_config?:      any
  output_config?:     any
}

function validate(r: InRow): string | null {
  if (!r.provider)            return 'provider is required'
  if (!r.model_name)          return 'model_name is required'
  if (!r.display_name)        return 'display_name is required'
  if (!Array.isArray(r.input_modalities)  || r.input_modalities.length === 0)
                              return 'input_modalities must be a non-empty array'
  if (!Array.isArray(r.output_modalities) || r.output_modalities.length === 0)
                              return 'output_modalities must be a non-empty array'
  // Provider is intentionally free-form so new providers can be staged
  // in the catalog before lib/providers/<name>.ts exists. Runtime calls
  // to such a row will fail in the provider router, which is the right
  // place to enforce that — the catalog table is just data.
  return null
}

export async function POST(req: Request): Promise<Response> {
  const guard = await assertAdmin()
  if (guard) return guard

  let body: InRow
  try { body = await req.json() }
  catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }

  const err = validate(body)
  if (err) return Response.json({ error: err }, { status: 400 })

  const sb = serviceClient()
  const row = {
    provider:           body.provider,
    model_name:         body.model_name,
    display_name:       body.display_name,
    enabled:            body.enabled    ?? true,
    is_popular:         body.is_popular ?? false,
    released_at:        body.released_at ?? null,
    input_modalities:   body.input_modalities,
    output_modalities:  body.output_modalities,
    tags:               body.tags ?? [],
    modes:              body.modes         ?? [],
    model_pricing:      body.model_pricing ?? null,
    input_config:       body.input_config  ?? null,
    output_config:      body.output_config ?? null,
    updated_at:         new Date().toISOString(),
  }

  const { data, error } = await sb
    .from('ai_models')
    .upsert(row, { onConflict: 'provider,model_name' })
    .select('*')
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, model: data })
}
