// lib/xsports-cheer-stats.ts — how each model does at 晴晴's fresh photos and
// clips (owner, Oct 16: "so we know which models are better"): from the asks
// (xsports_cheer_jobs, supabase/137) and, for what was posted, fans' 👍 / 👎
// (xsports_media_votes) and reports (xsports_room_reports). For
// /admin/traffic. Server-only; reads with the service key it is given.

export interface CheerModelRow {
  model: string; label: string; kind: 'image' | 'video'
  made: number; failed: number; posted: number; up: number; down: number; reports: number
  medianMs: number | null; avgUsd: number | null
}

type Job = { kind: string; status: string; model: string | null; frame_model: string | null; tried: string[] | null; ms: number | null; usd: number | null; posted_message_id: number | null }

/** The range's rows (photos, then clips; best liked first); null before
 *  137 runs. */
export async function cheerModelStats(sb: any, days: number, now = Date.now()): Promise<CheerModelRow[] | null> {
  const since = new Date(now - days * 86_400_000).toISOString()
  const { data, error } = await sb.from('xsports_cheer_jobs').select('kind, status, model, frame_model, tried, ms, usd, posted_message_id').gte('created_at', since).limit(5000)
  if (error) return null
  const jobs = (data ?? []) as Job[]
  const posted = [...new Set(jobs.map(j => j.posted_message_id).filter((x): x is number => typeof x === 'number'))]
  const [votes, reports] = posted.length
    ? await Promise.all([
        sb.from('xsports_media_votes').select('message_id, vote').in('message_id', posted),
        sb.from('xsports_room_reports').select('message_id').in('message_id', posted),
      ])
    : [{ data: [] }, { data: [] }]
  const up = new Map<number, number>(), down = new Map<number, number>(), flagged = new Map<number, number>()
  for (const v of (votes.data ?? []) as { message_id: number; vote: number }[]) (v.vote > 0 ? up : down).set(v.message_id, ((v.vote > 0 ? up : down).get(v.message_id) ?? 0) + 1)
  for (const r of (reports.data ?? []) as { message_id: number }[]) flagged.set(r.message_id, (flagged.get(r.message_id) ?? 0) + 1)

  // Every model named, as people read it, and whether it makes clips.
  const keys = [...new Set(jobs.flatMap(j => [j.model, j.frame_model, ...(j.tried ?? [])]).filter((k): k is string => !!k))]
  const { data: models } = keys.length
    ? await sb.from('ai_models').select('provider, model_name, display_name, output_modalities').in('model_name', keys.map(k => k.split('/').slice(1).join('/')))
    : { data: [] }
  const info = new Map(((models ?? []) as { provider: string; model_name: string; display_name: string; output_modalities: string[] | null }[])
    .map(m => [`${m.provider}/${m.model_name}`, { label: m.display_name, clip: (m.output_modalities ?? []).includes('video') }]))
  const kindOf = (k: string): 'image' | 'video' => (info.get(k)?.clip ? 'video' : 'image')

  const rows = new Map<string, CheerModelRow & { ms: number[]; usd: number[] }>()
  const at = (model: string) => {
    if (!rows.has(model)) rows.set(model, { model, label: info.get(model)?.label ?? model, kind: kindOf(model), made: 0, failed: 0, posted: 0, up: 0, down: 0, reports: 0, medianMs: null, avgUsd: null, ms: [], usd: [] })
    return rows.get(model)!
  }
  for (const j of jobs) {
    // Tried and not the one that made it (nor a clip's first frame): failed.
    const makers = new Set(j.status === 'done' ? [j.model, j.frame_model].filter(Boolean) as string[] : [])
    for (const t of j.tried ?? []) if (!makers.has(t)) at(t).failed++
    if (j.status !== 'done' || !j.model) continue
    const r = at(j.model)
    r.made++
    if (typeof j.ms === 'number') r.ms.push(j.ms)
    if (j.usd != null) r.usd.push(Number(j.usd))
    if (j.posted_message_id) {
      r.posted++
      r.up += up.get(j.posted_message_id) ?? 0
      r.down += down.get(j.posted_message_id) ?? 0
      r.reports += flagged.get(j.posted_message_id) ?? 0
    }
  }
  const median = (a: number[]) => { if (!a.length) return null; const t = [...a].sort((x, y) => x - y); return t[Math.floor(t.length / 2)] }
  return [...rows.values()]
    .map(({ ms, usd, ...r }) => ({ ...r, medianMs: median(ms), avgUsd: usd.length ? usd.reduce((a, b) => a + b, 0) / usd.length : null }))
    // Photos, then clips; in each, the models that made something (best
    // liked, then most made), then those that only failed (fewest first).
    .sort((a, b) => (a.kind !== b.kind ? (a.kind === 'image' ? -1 : 1)
      : (b.made > 0 ? 1 : 0) - (a.made > 0 ? 1 : 0) || (b.up - b.down) - (a.up - a.down) || b.made - a.made || a.failed - b.failed))
}
