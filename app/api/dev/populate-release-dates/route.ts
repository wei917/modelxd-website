// app/api/dev/populate-release-dates/route.ts
//
// DEV-ONLY. Fetches the current OpenRouter model catalog and backfills
// the `released_at` column on ai_models. OpenRouter returns a `created`
// field (Unix seconds) for every text/image model; we convert that into
// a Postgres timestamptz and write it via the Supabase admin client.
//
// Video models don't appear in /v1/models — they live under /v1/videos/models
// and that endpoint doesn't expose a `created` field, so they stay null
// and sort to the bottom of the picker.
//
// Usage:
//   POST /api/dev/populate-release-dates
// Returns:
//   {
//     fetched: <total OR models seen>,
//     updated: <rows whose released_at changed>,
//     skipped: <OR models with no created field>,
//     unmatched: [<model_name>, ...]  // in OR but not in our ai_models
//   }

import { createClient } from '@supabase/supabase-js'

interface ORModel {
  id: string
  created?: number
}

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not Found', { status: 404 })
  }

  // 1. Fetch OpenRouter catalog. This endpoint is public (no key needed).
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) {
    return Response.json(
      { error: `OpenRouter /api/v1/models returned ${res.status}` },
      { status: 502 },
    )
  }
  const json = (await res.json()) as { data?: ORModel[] }
  const models = json.data ?? []

  // 2. Load all existing model_names from ai_models so we only attempt
  // updates on rows we actually have. Using the secret key bypasses RLS.
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
  const { data: existingRows, error: loadErr } = await sb
    .from('ai_models')
    .select('model_name')
  if (loadErr) {
    return Response.json(
      {
        error: `failed to load ai_models — did you run the ALTER TABLE? Detail: ${loadErr.message}`,
      },
      { status: 500 },
    )
  }
  const existing = new Set((existingRows ?? []).map(r => r.model_name as string))

  // 3. Build one row per matching OpenRouter model and write them all in
  // a single batched upsert. We originally did ~300 sequential .update()
  // calls here — curl would appear to hang for 30+ seconds while each
  // round-trip completed. Batching collapses that into a handful of
  // requests, which finishes in well under a second.
  //
  // We use upsert with onConflict on (provider, model_name) — the unique
  // index added in 08_openrouter_rebuild.sql — and filter to rows we
  // already have, so every write hits the UPDATE branch and nothing new
  // is inserted.
  const updates: Array<{ provider: string; model_name: string; released_at: string }> = []
  let skipped = 0
  const unmatched: string[] = []

  for (const m of models) {
    if (!m.created) {
      skipped++
      continue
    }
    if (!existing.has(m.id)) {
      unmatched.push(m.id)
      continue
    }
    updates.push({
      provider: 'openrouter',
      model_name: m.id,
      released_at: new Date(m.created * 1000).toISOString(),
    })
  }

  const BATCH = 100
  let updated = 0
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH)
    const { error } = await sb
      .from('ai_models')
      .upsert(batch, { onConflict: 'provider,model_name' })
    if (error) {
      return Response.json(
        {
          error: `batch upsert failed at offset ${i}: ${error.message}`,
          batchSize: batch.length,
          updatedSoFar: updated,
        },
        { status: 500 },
      )
    }
    updated += batch.length
  }

  return Response.json({
    fetched: models.length,
    updated,
    skipped,
    unmatchedCount: unmatched.length,
    // Only return the first 20 unmatched names so the response stays small.
    unmatched: unmatched.slice(0, 20),
  })
}
