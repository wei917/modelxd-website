// scripts/test-xtell-personality.ts — the visitor's own personality type
// (Sep 30): the type parser, what the teacher is told, which rooms offer it,
// the account-page route (own row only, refusals, migration not run), the
// visit keeps it, the migration's privileges, the strings. No network.
//   npx tsx scripts/test-xtell-personality.ts

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import * as pt from '../lib/xtell-personality'
import { STRINGS } from '../lib/i18n'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

// ── The type ───────────────────────────────────────────────────────────────
check('the four letters, any case, with an optional -A / -T', pt.asPersonalityType('infj') === 'INFJ' && pt.asPersonalityType(' ESTP-t ') === 'ESTP-T' && pt.asPersonalityType('INTJ-A') === 'INTJ-A')
check('anything else is no type', [null, undefined, 3, '', 'INF', 'INFJX', 'IENJ', 'INFJ-B', 'INFJ-', 'XNFJ', '<b>INFJ</b>'].every(v => pt.asPersonalityType(v) === null))
check('the account page edits it as four choices and a fifth', JSON.stringify(pt.partsOf('ENFP-T')) === JSON.stringify({ letters: ['E', 'N', 'F', 'P'], identity: 'T' }) && pt.typeOf({ letters: ['I', 'S', 'T', 'J'], identity: '' }) === 'ISTJ' && pt.typeOf({ letters: ['I', '', 'T', 'J'], identity: '' }) === null)
const all = new Set<string>()
for (const a of 'EI') for (const b of 'SN') for (const c of 'TF') for (const d of 'JP') for (const e of ['', 'A', 'T']) { const p = pt.partsOf(a + b + c + d + (e ? `-${e}` : '')); if (p && pt.typeOf(p)) all.add(pt.typeOf(p)!) }
check('all 48 round-trip', all.size === 48)

// ── The teacher ────────────────────────────────────────────────────────────
const f = pt.personalityFacts('INFJ-A')
check('the teacher is told it is the visitor\'s own description, not a fortune or a diagnosis', f.includes('來訪者：INFJ-A') && f.includes('自我描述') && f.includes('不是命理資料') && f.includes('不是診斷'))
check('…to use it only where it fits, never over the stick, cards, chart or book, never as fate or a ranking', f.includes('只在與問題相關時參考') && f.includes('不可用它推翻籤、牌、命盤或書中原文') && f.includes('決定命運') && f.includes('哪一型比較好'))
check('月老: the other person\'s type, said to be typed in by the visitor', pt.personalityFacts('INFJ', 'entp').includes('對方：ENTP（同樣由來訪者填寫') && pt.personalityFacts(null, 'ENTP').includes('對方：ENTP') && !pt.personalityFacts(null, 'ENTP').includes('來訪者：'))
check('nothing valid attached: nothing said', pt.personalityFacts(undefined) === '' && pt.personalityFacts('hello', 'x') === '')
check('offered in 孫子兵法, 月老 and 塔羅 only', ['sunzi', 'yuelao', 'tarot'].every(pt.offersPersonality) && ['guanyin', 'guandi', 'mazu', 'bazi', 'ziwei', 'zhanxing', 'navagraha', 'kyusei', 'sukuyo', 'xingming', 'cezi', 'yixue', 'jiemeng', 'cookie', 'simianfo', 'daily'].every(t => !pt.offersPersonality(t)))

const reading = read('app/api/xtell/reading/route.ts'), chart = read('app/api/xtell/chart/route.ts'), client = read('app/xtell/client.tsx')
check('the reading route adds it only in those rooms, never to the daily reading, after the chart\'s own facts', reading.includes("const typeFacts = !daily && offersPersonality(temple) ? personalityFacts(body?.mbti, temple === 'yuelao' ? body?.mbti2 : undefined) : ''") && reading.includes('const facts = typeFacts ? `${chartFacts}\\n\\n${typeFacts}` : chartFacts'))
check('the visit keeps what was attached, so a reopened visit asks with the same type', /SUBJECT_KEYS = \[[^\]]*'mbti', 'mbti2'\]/.test(chart) && client.includes('asPersonalityType(init.mbti) ?? savedType'))
check('the box is off by default and sends nothing until ticked', client.includes('useState<boolean>(!!asPersonalityType(init.mbti))') && client.includes('offersPersonality(temple) && withType ?'))
check('the three rooms show the box; the tarot one sits above the deal button', (client.match(/<PersonalityAttach /g) ?? []).length === 3 && client.includes('extra={<PersonalityAttach'))

// ── The account-page route ─────────────────────────────────────────────────
function loadRoute(file: string, modules: Record<string, unknown>) {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports: any = {}
  vm.runInNewContext(js, {
    exports, console: { ...console, warn: () => {} }, process, Response, Request,
    require: (name: string) => { if (!(name in modules)) throw new Error('unexpected route dependency: ' + name); return modules[name] },
  }, { filename: file })
  return exports
}
type R = { user_id: string; type: string; source: string; scores: unknown; updated_at: string }
function fakeAdmin(rows: R[], missing = false) {
  const err = missing ? { code: '42P01', message: 'relation "xtell_personality" does not exist' } : null
  return () => ({
    from: (table: string) => {
      if (table !== 'xtell_personality') throw new Error('wrong table ' + table)
      return {
        select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: err ? null : rows.find(r => r.user_id === id) ?? null, error: err }) }) }),
        upsert: (row: R) => ({ select: () => ({ single: async () => {
          if (err) return { data: null, error: err }
          const i = rows.findIndex(r => r.user_id === row.user_id)
          if (i >= 0) rows[i] = row; else rows.push(row)
          return { data: row, error: null }
        } }) }),
        delete: () => ({ eq: async (_c: string, id: string) => { if (!err) rows.splice(0, rows.length, ...rows.filter(r => r.user_id !== id)); return { error: err } } }),
      }
    },
  })
}
const route = (user: { id: string } | null, rows: R[], missing = false) => loadRoute('app/api/xtell/personality/route.ts', {
  '@/lib/supabase-server': { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
  '@/lib/xtell-admin': { xtellAdmin: fakeAdmin(rows, missing), dailyMissing: (e: any) => e?.code === '42P01' },
  '@/lib/xtell-personality': pt,
})
const put = (body: unknown) => new Request('http://t/api/xtell/personality', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function routeChecks() {
  const rows: R[] = [{ user_id: 'b', type: 'ESTJ', source: 'self', scores: null, updated_at: '2026-09-01' }]
  const a = route({ id: 'a' }, rows)
  check('signed out: 401 on every method', (await route(null, rows).GET()).status === 401 && (await route(null, rows).PUT(put({ type: 'INFJ' }))).status === 401 && (await route(null, rows).DELETE()).status === 401)
  check('nothing saved yet: null', (await (await a.GET()).json()).personality === null)
  const saved = await (await a.PUT(put({ type: 'infj-a', user_id: 'b' }))).json()
  check('save: normalised, typed in = self, and only the caller\'s row (a user_id in the body is ignored)', saved.personality?.type === 'INFJ-A' && saved.personality?.source === 'self' && rows.find(r => r.user_id === 'b')?.type === 'ESTJ' && rows.find(r => r.user_id === 'a')?.type === 'INFJ-A')
  check('a bad type is refused, nothing written', (await a.PUT(put({ type: 'INFX' }))).status === 400 && rows.find(r => r.user_id === 'a')?.type === 'INFJ-A')
  check('read back', (await (await a.GET()).json()).personality?.type === 'INFJ-A')
  check('delete removes only the caller\'s', (await a.DELETE()).status === 200 && !rows.some(r => r.user_id === 'a') && rows.some(r => r.user_id === 'b'))
  const m = route({ id: 'a' }, [], true)
  check('migration 119 not run: 503, so the account page hides the section', (await m.GET()).status === 503 && (await m.PUT(put({ type: 'INFJ' }))).status === 503 && (await m.DELETE()).status === 503)
}

// ── The migration and the strings ──────────────────────────────────────────
const mig = read('supabase/119_xtell_personality.sql')
check('119: server only, revoked from public, anon and authenticated by name, RLS on, gone with the account', /revoke all on table public\.xtell_personality from public, anon, authenticated/.test(mig) && /enable row level security/.test(mig) && /references auth\.users\(id\) on delete cascade/.test(mig) && /grant select, insert, update, delete on table public\.xtell_personality to service_role/.test(mig))
check('119: the same type rule as the code', mig.includes("check (type ~ '^[EI][SN][TF][JP](-[AT])?$')"))
const S = STRINGS as any, LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']
const keys = Object.keys(S).filter(k => k.startsWith('xtell.pt.'))
check('its strings exist in five languages', keys.length >= 27 && keys.every(k => LANGS.every(l => typeof S[k]?.[l] === 'string' && S[k][l].trim())), String(keys.length))
check('the trademark note names its owner and says this is not the official test', LANGS.every(l => S['xtell.pt.tm'][l].includes('MBTI®') && S['xtell.pt.tm'][l].includes('The Myers-Briggs Company')))
check('the room box names the type only once ticked; unticked it says nothing about which', LANGS.every(l => S['xtell.pt.attach'][l].includes('{type}') && !/\{type\}|[EI][SN][TF][JP]/.test(S['xtell.pt.attachPlain'][l])) && read('app/components/xtell/XTellPersonality.tsx').includes("{on ? t('xtell.pt.attach').replace('{type}', saved) : t('xtell.pt.attachPlain')}"))
check('the account page keeps the saved type hidden until 修改, like the birthday', read('app/components/xtell/XTellPersonality.tsx').includes("<span>{t('xtell.dy.savedHidden')}</span>") && !read('app/components/xtell/XTellPersonality.tsx').includes('<span className="xtell-pt-type">{saved}</span>'))
check('the account page shows the section on the XTell door', read('app/profile/page.tsx').includes('<DailyProfileSettings /><PersonalitySettings />'))

routeChecks().then(() => {
  console.log(fails ? `\n${fails} FAILED` : '\nall personality checks passed')
  if (fails) process.exit(1)
})
