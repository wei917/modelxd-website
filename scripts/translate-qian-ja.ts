// scripts/translate-qian-ja.ts — 書き下し文 and a modern Japanese translation
// for the temple poems shown on Japanese pages (Sep 29), as
// content/qian/kundoku-ja.json.
//
// A test round found the three 求籤 rooms showing bare classical Chinese on
// Japanese pages, and teachers improvising kanbun readings that were wrong
// (「先有滯」 read 「さきにつよいあり」; 「求名清吉正當時」 turned into
// nonsense kana). A Japanese おみくじ prints the 書き下し and a plain
// translation beside the poem, so each poem gets both, written once and
// labelled as the AI's on the page; the teacher is given the same text and
// told to quote it rather than make its own (lib/xtell.ts guandiFacts).
//
// The sets: 關帝 100, 媽祖 60, 元三大師 観音百籤 100 (the Japanese pages'
// 觀音 edition). 260 poems.
//
// THIS SPENDS MONEY: Claude Opus 5.5, ten poems a call, about $0.0078 a poem
// measured (≈ $2.04 for all 260; GPT-6 Astra measured $0.022 a poem, ≈ $5.81,
// with readings no better). It resumes: poems already in the file are
// skipped, so a rerun after a change to the corpus only pays for the new
// ones. It stops once CAP dollars are spent in this run.
//
//   npx tsx --env-file=.env.local scripts/translate-qian-ja.ts            # dry run: how many are missing
//   CAP=3 npx tsx --env-file=.env.local scripts/translate-qian-ja.ts --apply

import fs from 'node:fs'
import * as providers from '../lib/providers'
import { getModelByProviderName } from '../lib/models'

const OUT = 'content/qian/kundoku-ja.json'
const SETS = ['guandi', 'mazu', 'guanyin-gansan'] as const
const MODEL = { provider: 'anthropic', name: 'claude-opus-5-5' }
const BATCH = 10

export const SYSTEM = `あなたは漢文訓読と中国古典詩に通じた日本の研究者です。中国や日本の寺社で使われる籤詩（おみくじの漢詩）を、日本の読者のために訓読し、現代語に訳します。

各詩について次の二つを書いてください。
1. kundoku：書き下し文。詩の一句につき一つの文字列（句の数と同じ数）。現代仮名遣い、常用漢字の新字体を使い、原詩の漢字はできるだけ漢字のまま残す。送り仮名と助詞を補い、返り点に従った日本語の語順にする。ふりがなや注は付けない。
2. modern：詩全体の現代語訳。自然で平易な日本語で一〜二文。詩が言っていることだけを訳し、吉凶の判定、占いの助言、解説は加えない。

訓読は伝統的な読み方に従い、意味が通るようにしてください。人名・故事・官職名はそのまま漢字で書きます。

JSON だけを返してください（前後に文章を書かない）：
{"items":[{"id":"<与えられた id>","kundoku":["…","…"],"modern":"…"}]}`

type Item = { id: string; poem: string[] }
type Reading = { kundoku: string[]; modern: string }
type File = { source: Record<string, unknown>; items: Record<string, Reading> }

const all: Item[] = SETS.flatMap(set => (JSON.parse(fs.readFileSync(`content/qian/${set}.json`, 'utf8')) as any[]).map(q => ({ id: `${set}:${q.n}`, poem: q.poem as string[] })))

async function translate(model: any, items: Item[]): Promise<{ items: any[] | null; cost: number; err: string }> {
  let text = '', cost = 0, err = ''
  const content = items.map(i => `id: ${i.id}\n${i.poem.join('\n')}`).join('\n\n')
  await new Promise<void>(resolve => {
    providers.streamText(model, [{ role: 'user', content }], {
      onDelta: (t: string) => { text += t }, onDone: (r: any) => { cost = r?.cost ?? 0; resolve() }, onError: (m: string) => { err = m; resolve() },
    }, [], {}, { thinking: null, search: false, maxTokens: 6000, system: SYSTEM } as any).catch((e: any) => { err = String(e?.message ?? e); resolve() })
  })
  const m = text.match(/\{[\s\S]*\}/)
  let parsed: any = null
  try { parsed = m ? JSON.parse(m[0]) : null } catch { /* unreadable: the batch is retried on the next run */ }
  return { items: Array.isArray(parsed?.items) ? parsed.items : null, cost, err }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const file: File = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { source: {}, items: {} }
  const todo = all.filter(i => !file.items[i.id])
  console.log(`${all.length} poems, ${todo.length} without a reading`)
  if (!apply || todo.length === 0) { if (!apply) console.log('dry run: add --apply to write (it spends money)'); return }
  const model = await getModelByProviderName(MODEL.provider, MODEL.name)
  if (!model?.enabled) throw new Error(`model not available: ${MODEL.provider}/${MODEL.name}`)
  const cap = Number(process.env.CAP ?? '3')
  let spent = 0
  for (let k = 0; k < todo.length; k += BATCH) {
    const batch = todo.slice(k, k + BATCH)
    const r = await translate(model, batch)
    spent += r.cost
    for (const it of r.items ?? []) {
      const src = batch.find(b => b.id === it.id)
      // One reading a line of the poem, or the item is left for a rerun.
      if (src && Array.isArray(it.kundoku) && it.kundoku.length === src.poem.length && it.kundoku.every((x: unknown) => typeof x === 'string' && x.trim()) && typeof it.modern === 'string' && it.modern.trim())
        file.items[it.id] = { kundoku: it.kundoku.map((x: string) => x.trim()), modern: it.modern.trim() }
    }
    file.source = {
      what: '書き下し文 and modern Japanese translation of the temple poems, written by an AI and labelled as such on the page',
      model: MODEL.name, script: 'scripts/translate-qian-ja.ts', sets: SETS,
    }
    fs.writeFileSync(OUT, JSON.stringify(file, null, 1) + '\n')
    console.log(`batch ${k / BATCH + 1}: ${Object.keys(file.items).length}/${all.length} done, spent $${spent.toFixed(3)} ${r.err}`)
    if (spent > cap) { console.log(`STOP: $${spent.toFixed(2)} passes the cap $${cap}`); break }
  }
  console.log(`spent $${spent.toFixed(3)}; ${Object.keys(file.items).length}/${all.length} poems have a reading`)
}
main().catch(e => { console.error('failed:', e?.message ?? e); process.exit(1) })
