import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as providers from '../lib/providers'
function loadEnv() {
  const p = join(process.cwd(), '.env.local'); if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq === -1) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnv()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

async function attempt(model: any, label: string, opts: any) {
  let out = ''
  try {
    await new Promise<void>((res, rej) => {
      providers.streamText(model, [{ role: 'user', content: '請計算 1990年1月1日 15:25 台北 男 的八字四柱。只輸出四柱。' }],
        { onDelta: (t: string) => { out += t }, onDone: () => res(), onError: (m: string) => rej(new Error(m)) },
        [], undefined, opts).catch(rej)
    })
    console.log(`  ${label.padEnd(34)} OK   ${out.trim().replace(/\s+/g, ' ').slice(0, 50)}`)
  } catch (e: any) {
    console.log(`  ${label.padEnd(34)} FAIL ${String(e.message).replace(/\s+/g, ' ').slice(0, 260)}`)
  }
}

async function main() {
  const { data: model } = await sb.from('ai_models').select('*').eq('model_name', 'claude-opus-5').maybeSingle()
  console.log('claude-opus-5 — isolating the 400')
  await attempt(model, 'no options at all', undefined)
  await attempt(model, 'thinking:max only (bazi-bench)', { thinking: 'max' })
  await attempt(model, 'system + thinking:max (mbti-run)', { system: 'Pretend you are a real human and answer the following question', thinking: 'max' })
  await attempt(model, 'system only', { system: 'You are helpful.' })
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) })
