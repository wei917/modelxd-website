// scripts/xtell-golden.ts — golden charts for the XTell engines.
//
//   npx tsx scripts/xtell-golden.ts        (also: npm run test:xtell)
//
// Idea learned from horosa-skill's 489-case chart-fact validation: the chart
// layer must be provably stable. These expected values were frozen on
// 2026-08-30 from lunar-typescript 1.8.6 / iztro 2.6.0; the first two BaZi
// cases were independently confirmed by four frontier models (and the 立春
// trap by hand). If a library upgrade changes ANY pillar or palace, this
// fails loudly — a silently shifted 排盤 is the one bug users would never
// forgive, and the one we could never detect from prose.

import { baziChart, ziweiChart } from '../lib/xtell'

let failures = 0
function eq(label: string, got: string, want: string) {
  const ok = got === want
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${label}: ${got}${ok ? '' : `  (expected ${want})`}`)
}

// ── BaZi ───────────────────────────────────────────────────────────────────
const CASES: Array<{ label: string; b: any; pillars: string; dayMaster: string }> = [
  { label: '1990-01-01 15:25 男 — before 立春 (year belongs to 己巳)',
    b: { y: 1990, m: 1, d: 1, h: 15, mi: 25, gender: 'male' },
    pillars: '己巳 丙子 丙寅 丙申', dayMaster: '丙' },
  { label: '1985-07-20 09:00 男 — ordinary mid-year',
    b: { y: 1985, m: 7, d: 20, h: 9, mi: 0, gender: 'male' },
    pillars: '乙丑 癸未 庚申 辛巳', dayMaster: '庚' },
  // 立春 2000 fell at 20:40:24 on Feb 4 (library JieQi table). These two
  // cases straddle that instant on the SAME calendar day: noon is still the
  // old year (己卯/丁丑), 21:30 is the new one (庚辰/戊寅), and the day
  // pillar 壬辰 rightly ignores the boundary. The first golden version of
  // this case carried a hand-written "expected" that was simply wrong —
  // frozen values must be OBSERVED, never recalled.
  { label: '2000-02-04 12:00 男 — same day, BEFORE the 20:40 立春 instant',
    b: { y: 2000, m: 2, d: 4, h: 12, mi: 0, gender: 'male' },
    pillars: '己卯 丁丑 壬辰 丙午', dayMaster: '壬' },
  { label: '2000-02-04 21:30 男 — same day, AFTER the 立春 instant',
    b: { y: 2000, m: 2, d: 4, h: 21, mi: 30, gender: 'male' },
    pillars: '庚辰 戊寅 壬辰 辛亥', dayMaster: '壬' },
  // 晚子時: the library keeps the day pillar (辛丑) and derives the 子時
  // stem from the NEXT day's stem (壬 → 庚子) — the 日不變、時遁次日干
  // school. Frozen so an upgrade silently switching schools fails here.
  { label: '1988-06-15 23:30 女 — 晚子時 (day stays, hour stem from next day)',
    b: { y: 1988, m: 6, d: 15, h: 23, mi: 30, gender: 'female' },
    pillars: '戊辰 戊午 辛丑 庚子', dayMaster: '辛' },
]

console.log('BaZi (lunar-typescript):')
for (const c of CASES) {
  const ch = baziChart(c.b)
  const p = ch.pillars
  eq(c.label, `${p.year.ganZhi} ${p.month.ganZhi} ${p.day.ganZhi} ${p.time.ganZhi}`, c.pillars)
  eq('  day master', ch.dayMaster, c.dayMaster)
}

// ── Zi Wei ─────────────────────────────────────────────────────────────────
console.log('\nZi Wei (iztro):')
const z = ziweiChart({ y: 1990, m: 1, d: 1, h: 15, mi: 25, gender: 'male' })
const ming: any = (z.palaces as any[]).find((p: any) => p.name === '命宮')
eq('1990-01-01 申時 男 — 命宮', `${ming?.ganZhi} ${(ming?.majorStars ?? []).join(',')}`, '己巳 巨門[旺]')
eq('  五行局', (z as any).fiveElementsClass, '木三局')
eq('  命主/身主', `${(z as any).soul}/${(z as any).body}`, '武曲/天機')

console.log(failures === 0 ? '\nall golden charts hold' : `\n${failures} FAILURE(S) — a library upgrade changed the 排盤. Do not ship until resolved.`)
process.exit(failures === 0 ? 0 : 1)
