// scripts/bazi-bench.ts — can models compute a 八字 chart?
//
// Ground truth from lunar-typescript. The task is genuinely hard and fully
// verifiable: 年柱 turns at 立春 (not lunar new year), 月柱 needs the 節
// boundary plus 五虎遁, 日柱 is a 60-cycle from a fixed epoch, 時柱 needs
// 五鼠遁. A model either matches all four pillars or it does not.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as providers from '../lib/providers'
import { Solar } from 'lunar-typescript'

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

const CASES = [
  { label: 'before 立春 (the classic trap)', y: 1990, m: 1,  d: 1,  h: 15, mi: 25 },
  { label: 'ordinary mid-year',              y: 1985, m: 7,  d: 20, h: 9,  mi: 0 },
  { label: 'day of 立春',                     y: 2000, m: 2,  d: 4,  h: 12, mi: 0 },
]

function truth(c: typeof CASES[number]) {
  const e = Solar.fromYmdHms(c.y, c.m, c.d, c.h, c.mi, 0).getLunar().getEightChar()
  return [e.getYear(), e.getMonth(), e.getDay(), e.getTime()]
}

async function ask(model: any, c: typeof CASES[number], thinking?: string) {
  const prompt = `請計算以下出生資料的八字四柱（年柱、月柱、日柱、時柱）。\n\n`
    + `國曆：${c.y}年${c.m}月${c.d}日\n時間：${String(c.h).padStart(2,'0')}:${String(c.mi).padStart(2,'0')}\n出生地：台灣台北\n性別：男\n\n`
    + `只輸出四柱，格式為「年柱 月柱 日柱 時柱」，例如「甲子 乙丑 丙寅 丁卯」。不要解釋。`
  let out = ''
  await new Promise<void>((res, rej) => {
    providers.streamText(model as any, [{ role: 'user', content: prompt }],
      { onDelta: (t: string) => { out += t }, onDone: () => res(), onError: (m: string) => rej(new Error(m)) },
      [], undefined, thinking ? ({ thinking } as any) : undefined).catch(rej)
  })
  const found = out.match(/[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/g) ?? []
  return { pillars: found.slice(0, 4), raw: out.trim().replace(/\s+/g, ' ').slice(0, 60) }
}

async function main() {
  const MODELS: Array<[string, string | undefined]> = [
    ['gpt-5.6-sol', 'max'], ['claude-opus-5', 'max'], ['grok-4.6', 'xhigh'], ['qwen3.8-max', 'thinking_true'],
  ]
  for (const c of CASES) {
    const t = truth(c)
    console.log(`\n=== ${c.y}-${c.m}-${c.d} ${c.h}:${String(c.mi).padStart(2,'0')}  [${c.label}]`)
    console.log(`    ground truth: ${t.join(' ')}`)
    for (const [name, thinking] of MODELS) {
      const { data: model } = await sb.from('ai_models').select('*').eq('model_name', name).maybeSingle()
      try {
        const { pillars } = await ask(model, c, thinking)
        const hits = pillars.filter((p, i) => p === t[i]).length
        console.log(`    ${(model as any).display_name.padEnd(16)} ${pillars.join(' ').padEnd(24)} ${hits}/4 ${hits === 4 ? '✓' : ''}`)
      } catch (e: any) {
        console.log(`    ${name.padEnd(16)} ERROR ${String(e.message).slice(0, 40)}`)
      }
    }
  }
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) })
