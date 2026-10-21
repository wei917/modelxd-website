// scripts/werewolf-decline-check.ts — does every model answer Werewolf's
// prompts? (Oct 21). Anthropic declined the old contract ({"reasoning":
// "<your private thinking, which nobody else ever sees>"}) as reasoning
// extraction on every turn for five Claude models, so those seats never
// spoke. The key is "why" now.
//
// Builds the route's own prompts (app/api/xtalk/werewolf/route.ts: night
// kill, seer, doctor, day speech, vote, the same seatPrompt / languageRule /
// outputContract) for a 7-seat table and sends each through runInference,
// the route's path. A reply counts when the turn's field reads out of the
// JSON. Real calls at list price, house-paid, a few cents per model.
//
//   npx tsx --env-file=.env.local scripts/werewolf-decline-check.ts [--lang zh-Hant] [--only "Claude Opus 5.5,GPT-6 Luna"]

import { createClient } from '@supabase/supabase-js'
import { runInference } from '../lib/inference'
import { seatPrompt, outputContract, parseJsonReply } from '../app/xtalk/werewolf'
import { languageRule } from '../lib/werewolf-lang'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
const LANG = (arg('--lang') ?? 'en') as any
const ONLY = arg('--only')?.split(',').map(s => s.trim()) ?? null

const NAMES = ['Alice', 'Bob', 'Carol', 'Dan', 'Eve', 'Finn', 'Gus']
const ROLES: Record<string, string> = { Alice: 'wolf', Bob: 'wolf', Carol: 'seer', Dan: 'doctor', Eve: 'villager', Finn: 'villager', Gus: 'villager' }
const all = NAMES.map(name => ({ name })) as any
const RULE = languageRule(LANG)

// The route's templates, verbatim (route.ts: kill 449, seer 466, doctor 484, day 527, vote 565).
const turns = [
  { who: 'Alice', field: 'kill', prompt: () => `${seatPrompt({ name: 'Alice', role: 'wolf' } as any, all, ['Bob'])}\n\nIt is night. Choose who the wolves kill. Living non-wolf players: Carol, Dan, Eve, Finn, Gus.\n\n${RULE}\n\n${outputContract('kill', 'the exact name of the player to kill')}` },
  { who: 'Carol', field: 'check', prompt: () => `${seatPrompt({ name: 'Carol', role: 'seer' } as any, all, [])}\n\nIt is night. Choose one player to investigate. Living players: Alice, Bob, Dan, Eve, Finn, Gus.\n\n${RULE}\n\n${outputContract('check', 'the exact name of the player to investigate')}` },
  { who: 'Dan', field: 'protect', prompt: () => `${seatPrompt({ name: 'Dan', role: 'doctor' } as any, all, [])}\n\nIt is night. Choose one player to protect. Living players: Alice, Bob, Carol, Eve, Finn, Gus.\n\n${RULE}\n\n${outputContract('protect', 'the exact name of the player to protect')}` },
  { who: 'Bob', field: 'say', day: true, prompt: () => `${seatPrompt({ name: 'Bob', role: 'wolf' } as any, all, ['Alice'])}\n\nIt is day 1. The discussion is below. Say what you think — accuse someone, defend yourself, share what you know, or press someone on what they said. Do not state your role outright unless you have decided that revealing it is worth it.\n\n${RULE}\n\n${outputContract('say', 'what you actually say aloud, under 90 words, plain prose, no lists')}` },
  { who: 'Eve', field: 'vote', day: true, prompt: () => `${seatPrompt({ name: 'Eve', role: 'villager' } as any, all, [])}\n\nDay 1 voting. You may vote for: Alice, Bob, Carol, Dan, Finn, Gus.\n\n${RULE}\n\n${outputContract('vote', 'the exact name of the player you vote to eliminate')}\n\nYour "why" is not shown to the table. Say aloud nothing here — this turn is the ballot only.` },
]
const DAY_TALK = [
  'Moderator said: Day 1. Gus was killed in the night.',
  'Carol said: Gus was quiet, so the wolves had no reason to fear him. I want to hear from Finn first.',
  'Finn said: I am a plain villager. Bob, you have not said a word yet. What do you think happened?',
]

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
  const { data } = await sb.from('ai_models').select('id, display_name, modes, blocked_features').eq('enabled', true).contains('output_modalities', ['text'])
  const models = (data ?? []).filter((m: any) => (m.modes ?? []).includes('text_to_text') && !(m.blocked_features ?? []).includes('xtalk_werewolf'))
    .filter((m: any) => !ONLY || ONLY.includes(m.display_name))
  console.log(`${models.length} models × ${turns.length} turns, ${LANG}`)
  let usd = 0
  await Promise.all(models.map(async (m: any) => {
    const cells: string[] = []
    for (const t of turns) {
      const msgs = [{ role: 'user' as const, content: t.prompt() }, ...(t.day ? DAY_TALK.map(c => ({ role: 'user' as const, content: c })) : [])]
      let text = '', err = ''
      const t0 = Date.now()
      await runInference({ userId: null as any, models: [m.id], messages: msgs, effort: null, search: false, surface: 'werewolf-check', bill: false, onUsage: (u: any) => { usd += u.costUsd }, onDelta: (d: string) => { text += d } } as any)
        .catch((e: any) => { err = String(e?.message ?? e) })
      // The route's own reader (askModel): JSON first, then a tolerant regex.
      const o = parseJsonReply(text)
      const grab = (f: string): string | undefined => {
        if (o && typeof o[f] === 'string') return String(o[f]).trim()
        const r = new RegExp(`["']${f}["']\\s*:\\s*["']([\\s\\S]*?)["']\\s*[,}]`).exec(text)
        return r ? r[1].trim() : undefined
      }
      const ok = !!grab(t.field) && !!(grab('why') ?? grab('reasoning'))
      cells.push(`${t.field}:${ok ? 'ok' : err ? (/declined/.test(err) ? 'DECLINED' : 'error') : 'unread'} ${((Date.now() - t0) / 1000).toFixed(0)}s`)
      if (!ok && err && !/declined/.test(err)) cells.push(`(${err.slice(0, 80)})`)
    }
    console.log(`${m.display_name.padEnd(24)} ${cells.join('  ')}`)
  }))
  console.log(`\n~$${usd.toFixed(3)}`)
  process.exit(0)
}
main()
