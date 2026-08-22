// scripts/story-digest.ts — run the XDirect story digest on a file from the
// terminal, no UI, no auth. Same pipeline as /api/xdirector/digest
// (lib/story-digest-run.ts): real catalog, real models, house-paid.
//
//   node --env-file=.env.local --import tsx scripts/story-digest.ts <file.pdf|file.txt> [--lang zh-Hant] [--focus "第七回"] [--extract-only]
//
// With no file it digests a short built-in fable — a pipeline smoke test
// that costs about a cent. --extract-only prints the size, the window plan
// and a preview of the extracted text, and calls no model.

import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { extractPdfText } from '../lib/pdf-extract'
import { MAX_DOC_CHARS } from '../lib/story-digest'
import { pickDigestModels, digestDocument } from '../lib/story-digest-run'

const FABLE = `第一章 山上的狐狸

山腳下的村子裡住著一隻老狐狸，名叫阿灰。阿灰的右耳缺了一角，身上的毛是灰色帶一點銀，脖子上總繫著一條褪色的紅布條。牠每天晚上都到村口偷雞，村民恨透了牠。

第二章 小女孩

村裡有個小女孩叫小荷，穿著一件打了補丁的藍色棉襖，頭髮用一根草繩綁著。小荷的奶奶病了，需要山頂的雪蓮才能醫好。可是山頂住著一隻大黑熊，沒有人敢上去。

第三章 交易

小荷在村口遇見了阿灰。她沒有叫人來抓牠，反而把自己僅有的一個饅頭分給牠吃。阿灰很驚訝。小荷說：「你認識山路嗎？帶我去山頂，我以後每天給你一個饅頭。」阿灰想了很久，答應了。

第四章 上山

兩人連夜上山。路上下起大雪，小荷的鞋子濕透了。阿灰把她帶到一個山洞裡躲雪，用自己的尾巴給她暖腳。小荷問阿灰為什麼要偷雞，阿灰說，因為牠老了，跑不過野兔了。

第五章 黑熊

到了山頂，黑熊果然守在雪蓮旁邊。阿灰叫小荷躲起來，自己跳出去引開黑熊。黑熊追著阿灰跑進了林子。小荷趁機採到了雪蓮，可是阿灰再也沒有回來。

第六章 回家

小荷帶著雪蓮回家，奶奶的病好了。從那天起，小荷每天晚上都在村口放一個饅頭。第七天早上，饅頭不見了，雪地上留下一串狐狸的腳印，還有一條褪色的紅布條。`

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const file = process.argv.slice(2).find(a => !a.startsWith('--') && a !== arg('--lang') && a !== arg('--focus'))
  const lang = arg('--lang') ?? 'zh-Hant'
  const focus = arg('--focus')

  let text = FABLE, label = 'built-in fable'
  if (file) {
    const buf = await fs.readFile(file)
    text = /\.pdf$/i.test(file) ? await extractPdfText(buf, { maxChars: MAX_DOC_CHARS }) : buf.toString('utf8').slice(0, MAX_DOC_CHARS)
    label = file
  }
  console.log(`source: ${label} — ${text.length.toLocaleString()} chars${focus ? `, focus "${focus}"` : ''}, lang ${lang}`)
  if (process.argv.includes('--extract-only')) {
    const { splitIntoWindows } = await import('../lib/story-digest')
    const w = splitIntoWindows(text)
    console.log(`windows: ${w.length} (≤ 40k chars each) · headings found: ${w.flatMap(x => x.headings).length}`)
    console.log(`first headings: ${w.flatMap(x => x.headings).slice(0, 6).join(' | ') || '(none)'}`)
    console.log(`preview: ${JSON.stringify(text.slice(0, 160))}`)
    return
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
  const { data: rows, error } = await sb.from('ai_models').select('*').eq('enabled', true)
  if (error) throw error
  const models = pickDigestModels((rows ?? []) as any[])
  if (!models) throw new Error('no text model in the catalog')
  console.log(`map → ${models.map.provider}/${models.map.model_name} | reduce → ${models.reduce.provider}/${models.reduce.model_name}\n`)

  const t0 = Date.now()
  const r = await digestDocument(text, { lang, focus, userId: null, models })
  console.log(r.text)
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s · ${r.windows} window(s) · cast ${r.bible.cast.length} · beats ${r.bible.beats.length} · house-paid $${r.cost.toFixed(4)} · bible by ${r.model}`)
}
main().catch(e => { console.error('FAILED:', e?.message ?? e); process.exit(1) })
