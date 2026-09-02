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

import { baziChart, ziweiChart, liuNian, guandiQian, validWishes } from '../lib/xtell'
import { drawQian, throwJiao } from '../lib/xtell-ritual'

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

// ── 關帝廟 ─────────────────────────────────────────────────────────────────
// The corpus must be whole: 100 sticks, four lines each, the 甲子 label in
// stick order (第一籤 甲甲 … 第一百籤 癸癸), 聖意 and 解曰 on every one.
console.log('\n關帝靈籤 (corpus):')
const qian = guandiQian()
eq('count', String(qian.length), '100')
eq('every poem has four lines', String(qian.every(q => q.poem.length === 4)), 'true')
eq('every stick has 聖意 and 解曰', String(qian.every(q => q.sections['聖意'] && q.sections['解曰'])), 'true')
eq('第1籤', `${qian[0].ganZhi} ${qian[0].luck} ${qian[0].poem[0]}`, '甲甲 大吉 巍巍獨步向雲間')
eq('第57籤', `${qian[56].ganZhi} ${qian[56].luck} ${qian[56].story}`, '己庚 中平 爛柯觀棋')
eq('第100籤', `${qian[99].ganZhi} ${qian[99].luck} ${qian[99].poem[3]}`, '癸癸 上上 抽得終籤百事宜')
// The ritual is arithmetic on a random source; drive it with fixed numbers.
eq('draw at 0 → 1, at 0.999 → 100', `${drawQian(() => 0)} ${drawQian(() => 0.999)}`, '1 100')
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length] }
eq('blocks: 陽陰 = 聖筊', throwJiao(seq(0.2, 0.8)), '聖筊')
eq('blocks: 陽陽 = 笑筊', throwJiao(seq(0.2, 0.2)), '笑筊')
eq('blocks: 陰陰 = 陰筊', throwJiao(seq(0.8, 0.8)), '陰筊')

// ── 四面佛 ─────────────────────────────────────────────────────────────────
// 流年 2026 丙午 against the 1990-01-01 chart (日主 丙, 日支 寅, 年支 巳):
// 丙 vs 丙 = 比肩; 午 vs 寅 = 三合 (寅午戌); 午 vs 巳 = 無特殊關係.
console.log('\n四面佛 (流年):')
const ln = liuNian(baziChart({ y: 1990, m: 1, d: 1, h: 15, mi: 25, gender: 'male' }), 1990, 2026)
eq('2026 流年', `${ln.ganZhi} ${ln.shiShen} 日支${ln.dayBranch.kind} 年支${ln.yearBranch.kind} ${ln.taiSui}`, '丙午 比肩 日支三合 年支無特殊關係 無')
eq('wishes: at least one face required', `${validWishes({ pledge: 'x' })} ${validWishes({ career: '升遷' })}`, 'false true')

console.log(failures === 0 ? '\nall golden charts hold' : `\n${failures} FAILURE(S) — a library upgrade changed the 排盤. Do not ship until resolved.`)
process.exit(failures === 0 ? 0 : 1)
