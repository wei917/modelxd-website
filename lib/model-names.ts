// The catalog's current name for each model, for pages that show a saved
// run. A duel keeps its own copy of each model's name from the moment it
// ran, so renaming a model in ai_models never reached old duels (owner,
// Oct 19: "I thought you read the model id and go to model table to get
// the model name"). The saved price stays what it was; only the name is
// read live. One read of the whole table (about 7 KB), kept in memory for
// a minute per server instance; the saved name is the fallback for a model
// no longer in the table, or when the read fails.

import { createClient } from '@supabase/supabase-js'

const TTL_MS = 60_000

type Names = { at: number; byId: Map<string, string>; byModel: Map<string, string> }

let cached: Names | null = null
let pending: Promise<Names> | null = null

async function load(): Promise<Names> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
  const { data, error } = await sb.from('ai_models').select('id, provider, model_name, display_name')
  if (error) throw error
  const byId = new Map<string, string>(), byModel = new Map<string, string>()
  for (const m of data ?? []) {
    if (!m.display_name) continue
    byId.set(String(m.id), m.display_name)
    byModel.set(`${m.provider}/${m.model_name}`, m.display_name)
  }
  return { at: Date.now(), byId, byModel }
}

async function names(): Promise<Names | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached
  pending ??= load().then(n => (cached = n)).finally(() => { pending = null })
  try { return await pending } catch (e: any) {
    console.warn('[model-names] read failed, keeping saved names:', e?.message ?? e)
    return cached
  }
}

/** Saved slots with each model's current catalog name in `name`, found by
 *  `model_id`, else provider + model_name. Anything else is untouched. */
export async function withModelNames<T>(slots: T): Promise<T> {
  if (!Array.isArray(slots) || slots.length === 0) return slots
  const n = await names()
  if (!n) return slots
  return slots.map((s: any) => {
    if (!s || typeof s !== 'object') return s
    const name = (s.model_id != null && n.byId.get(String(s.model_id)))
      || (s.provider && s.model_name && n.byModel.get(`${s.provider}/${s.model_name}`))
    return name && name !== s.name ? { ...s, name } : s
  }) as T
}
