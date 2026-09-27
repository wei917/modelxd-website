// scripts/run-trending.ts — run the weekly trending search now, from a laptop.
//
//   npx tsx scripts/run-trending.ts            # video
//   npx tsx scripts/run-trending.ts image
//
// Same code as the Monday cron and the admin page's "run" (lib/trending-job):
// several Grok x_search calls on the house xAI key, candidates stored as
// 'pending' for /admin/trending, the month's budget checked first. Costs
// real money (~$0.25–0.80 per search, not cappable per call).

import { readFileSync } from 'node:fs'
import path from 'node:path'

;(() => {
  try {
    for (const line of readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* fine if missing */ }
})()

async function main() {
  const kind = process.argv[2] === 'image' ? 'image' : 'video'
  const { runTrending } = await import('../lib/trending-job')
  const report = await runTrending(kind)
  console.log(JSON.stringify(report, null, 2))
}
// provider_calls rows are sent in the background; give them a moment before
// the process exits, or a failed run leaves only its 'start' rows (Sep 27).
const flush = () => new Promise(r => setTimeout(r, 3000))
main().then(flush).catch(async err => { console.error(err); await flush(); process.exit(1) })
