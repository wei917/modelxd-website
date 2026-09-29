// scripts/test-xtell-history.ts — renaming a saved visit (owner, Sep 28):
// what a name is kept as, what an emptied name goes back to, and that a
// rename which matched no row is reported as a failure.
//   npx tsx scripts/test-xtell-history.ts

import { cleanTitle, firstAsk, renameReading, TITLE_MAX } from '../lib/xtell-history'
import { STRINGS } from '../lib/i18n'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }

check('a name keeps its words, spaces folded', cleanTitle('  我的  工作 \n 問題 ') === '我的 工作 問題')
check(`a name is cut at ${TITLE_MAX} characters, the automatic title's limit`, [...cleanTitle('字'.repeat(200))!].length === TITLE_MAX && TITLE_MAX === 80)
check('an empty name goes back to the automatic title', cleanTitle('   ') === null && cleanTitle(null) === null)
check('the automatic title is the first question asked', firstAsk([{ role: 'assistant', content: 'x' }, { role: 'user', content: '  今年換工作好嗎？ ' }, { role: 'user', content: '第二題' }]) === '今年換工作好嗎？' && firstAsk([]) === null && firstAsk(undefined) === null)

function fakeClient(matches: number, error: unknown = null) {
  const calls: any[] = []
  const q: any = { update: (v: any) => { calls.push(['update', v]); return q }, eq: (k: string, v: any) => { calls.push(['eq', k, v]); return q }, select: () => Promise.resolve({ data: Array.from({ length: matches }, (_, i) => ({ id: String(i) })), error }) }
  return { sb: { from: (t: string) => { calls.push(['from', t]); return q } }, calls }
}
async function run() {
  const ok = fakeClient(1)
  check('a rename writes the cleaned name to that row', await renameReading(ok.sb, 'row-1', ' 新名字 ') && JSON.stringify(ok.calls) === JSON.stringify([['from', 'xtell_readings'], ['update', { title: '新名字' }], ['eq', 'id', 'row-1']]))
  const cleared = fakeClient(1)
  check('clearing writes null, so the automatic title shows again', await renameReading(cleared.sb, 'row-1', '') && cleared.calls[1][1].title === null)
  check('a rename that matched no row (not yours, or gone) is a failure', !(await renameReading(fakeClient(0).sb, 'row-x', 'a')) && !(await renameReading(fakeClient(1, { message: 'rls' }).sb, 'row-1', 'a')))
  const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']
  const keys = Object.keys(STRINGS).filter(k => k.startsWith('xtell.saved.rename'))
  check(`${keys.length} rename strings in five languages`, keys.length === 5 && keys.every(k => LANGS.every(l => (STRINGS as any)[k][l]?.trim())))
  console.log(fails ? `\n${fails} FAILED` : '\nall history checks passed')
  if (fails) process.exit(1)
}
run()
