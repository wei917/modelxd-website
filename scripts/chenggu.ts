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

const PROMPT = `請用袁天罡稱骨算命法，計算下列命造的骨重。

農曆：一九八九年（己巳年）臘月初五
時辰：申時
性別：男

請分別列出四項重量，再列出合計。格式：
年 X兩X錢 / 月 X兩X錢 / 日 X兩X錢 / 時 X兩X錢 / 合計 X兩X錢
不要其他說明。`

async function ask(name: string, thinking?: string) {
  const { data: model } = await sb.from('ai_models').select('*').eq('model_name', name).maybeSingle()
  let out = ''
  try {
    await new Promise<void>((res, rej) => {
      providers.streamText(model as any, [{ role: 'user', content: PROMPT }],
        { onDelta: (t: string) => { out += t }, onDone: () => res(), onError: (m: string) => rej(new Error(m)) },
        [], undefined, thinking ? ({ thinking } as any) : undefined).catch(rej)
    })
    console.log(`  ${(model as any).display_name.padEnd(15)} ${out.trim().replace(/\s+/g, ' ').slice(0, 150)}`)
  } catch (e: any) {
    console.log(`  ${name.padEnd(15)} ERROR ${String(e.message).slice(0, 80)}`)
  }
}

async function main() {
  console.log('稱骨 for 己巳年 臘月 初五 申時 (male) — no ground truth, agreement is the only signal\n')
  for (const [n, t] of [['gpt-5.6-sol','max'],['claude-opus-5','max'],['grok-4.6','xhigh'],['qwen3.8-max','thinking_true']] as Array<[string,string]>) await ask(n, t)
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) })
