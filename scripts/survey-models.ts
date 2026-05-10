// scripts/survey-models.ts
//
// Quick read-only survey of ai_models to surface cleanup candidates.
// Lists every row grouped by provider with a short flag string showing:
//   D = disabled
//   r = null released_at
//   p = missing pricing (no input/output/image/video price)
//   m = missing output_modalities
//
// Run:  npx tsx scripts/survey-models.ts

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadEnv() {
  const envPath = join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const raw = readFileSync(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnv()

interface Row {
  id: string
  provider: string
  model_name: string
  display_name: string | null
  enabled: boolean
  released_at: string | null
  model_pricing: {
    tokens?:           Record<string, number>
    per_image?:        Record<string, number>
    per_video_second?: Record<string, number>
  } | null
  output_modalities: string[] | null
}

function hasPrice(r: Row): boolean {
  const p = r.model_pricing
  if (!p) return false
  if (p.tokens           && Object.keys(p.tokens).length           > 0) return true
  if (p.per_image        && Object.keys(p.per_image).length        > 0) return true
  if (p.per_video_second && Object.keys(p.per_video_second).length > 0) return true
  return false
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function flags(r: Row): string {
  const f: string[] = []
  if (!r.enabled) f.push('D')
  if (!r.released_at) f.push('r')
  if (!hasPrice(r)) f.push('p')
  if (!r.output_modalities || r.output_modalities.length === 0) f.push('m')
  return f.length ? `[${f.join('')}]` : '   '
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
  const { data, error } = await sb
    .from('ai_models')
    .select('id, provider, model_name, display_name, enabled, released_at, model_pricing, output_modalities')
    .order('provider')
    .order('model_name')
  if (error) throw error
  const rows = (data ?? []) as Row[]

  // Aggregate
  const byProvider: Record<string, Row[]> = {}
  for (const r of rows) {
    (byProvider[r.provider] ??= []).push(r)
  }

  console.log(`=== ai_models survey: ${rows.length} total rows ===\n`)
  console.log('Flags: D=disabled, r=null released_at, p=missing pricing, m=missing output_modalities\n')

  for (const provider of Object.keys(byProvider).sort()) {
    const list = byProvider[provider]
    const enabled  = list.filter(r => r.enabled).length
    const disabled = list.length - enabled
    const noDate   = list.filter(r => !r.released_at).length
    const noPrice  = list.filter(r => !hasPrice(r)).length

    console.log(`── ${provider.toUpperCase()}  (${list.length} rows · ${enabled} enabled · ${disabled} disabled · ${noDate} no-date · ${noPrice} no-price)`)
    for (const r of list) {
      const out  = (r.output_modalities ?? []).join(',') || '?'
      console.log(`  ${flags(r)} ${pad(r.model_name, 42)} ${pad((r.display_name ?? '').slice(0, 25), 26)} ${pad(fmtDate(r.released_at), 10)} ${out}`)
    }
    console.log()
  }

  // Cross-provider stats
  const totals = rows.reduce((acc, r) => {
    if (!r.enabled) acc.disabled++
    if (!r.released_at) acc.noDate++
    if (!hasPrice(r)) acc.noPrice++
    if (!r.output_modalities || r.output_modalities.length === 0) acc.noMod++
    return acc
  }, { disabled: 0, noDate: 0, noPrice: 0, noMod: 0 })
  console.log('=== Cleanup candidates ===')
  console.log(`  disabled:           ${totals.disabled}`)
  console.log(`  null released_at:   ${totals.noDate}`)
  console.log(`  missing pricing:    ${totals.noPrice}`)
  console.log(`  missing modalities: ${totals.noMod}`)
}

main().catch(e => { console.error(e); process.exit(1) })
