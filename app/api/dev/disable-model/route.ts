// app/api/dev/disable-model/route.ts
//
// DEV-ONLY endpoint for quickly disabling a misbehaving model during local
// testing. Guarded so it only runs in development — production requests are
// rejected with 404.
//
// Usage:
//   POST /api/dev/disable-model
//   body: { "model_name": "arcee-ai/virtuoso-large" }
//
// This keeps us moving during local testing without needing to jump to the
// Supabase SQL editor every time OpenRouter surfaces a non-serverless model.

import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not Found', { status: 404 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const modelName = body?.model_name
  if (!modelName || typeof modelName !== 'string') {
    return Response.json({ error: 'model_name required' }, { status: 400 })
  }

  // Use the secret key to bypass RLS — this is an admin-only dev tool.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )

  const { data, error } = await supabase
    .from('ai_models')
    .update({ enabled: false })
    .eq('model_name', modelName)
    .select('model_name, enabled')

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ disabled: data })
}
