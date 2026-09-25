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

import { baziChart, ziweiChart, liuNian, guandiQian, qianCorpus, validQian, validWishes } from '../lib/xtell'
import { drawQian, throwJiao } from '../lib/xtell-ritual'
import { nameChart, charInfo, shuli } from '../lib/names'
import { jyotishChart, lahiriAyanamsa, NAKSHATRA, RASI } from '../lib/jyotish'

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
// 運限 frozen at 2026-09-24: 大限 in the natal 子女宮 (33–42), 流年 2026 丙午
// with its 命宮 on the natal 父母宮, 流年四化 from the 丙 stem.
const zh = ziweiChart({ y: 1990, m: 1, d: 1, h: 15, mi: 25, gender: 'male' }, new Date(2026, 8, 24))
eq('  大限 @2026-09-24', `${zh.horoscope.decadal.palace} ${zh.horoscope.decadal.range?.join('-')} ${zh.horoscope.decadal.ganZhi}`, '子女 33-42 丙寅')
eq('  流年 2026', `${zh.horoscope.years[0].year} ${zh.horoscope.years[0].ganZhi} 命宮在${zh.horoscope.years[0].palace} 四化 ${zh.horoscope.years[0].mutagen.join('')}`, '2026 丙午 命宮在父母 四化 天同天機文昌廉貞')
eq('  流年官祿 maps to a natal palace', String(!!zh.horoscope.years[0].roles['官祿']), 'true')

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

// ── 媽祖廟 ─────────────────────────────────────────────────────────────────
// The 六十甲子籤: 60 sticks in 甲子 order (甲子, 甲寅, 甲辰 … 癸亥 — the
// traditional 籤 ordering steps by two branches, not the calendar's one),
// four lines each, the 卦頭故事 on every stick.
console.log('\n媽祖 六十甲子籤 (corpus):')
const mz = qianCorpus('mazu')
eq('count', String(mz.length), '60')
eq('every poem has four lines', String(mz.every(q => q.poem.length === 4)), 'true')
eq('every stick has 卦頭故事', String(mz.every(q => q.sections['卦頭故事'])), 'true')
eq('第1籤', `${mz[0].ganZhi} ${mz[0].luck} ${mz[0].poem[0]}`, '甲子 屬金利秋 宜其西方 日出便見風雲散')
eq('第13籤', `${mz[12].ganZhi} ${mz[12].story}`, '丙子 撐渡伯遇桃花')
eq('第60籤', `${mz[59].ganZhi} ${mz[59].poem[3]}`, '癸亥 當官分理便有益')
eq('61 is not a 媽祖 stick, 100 is a 關帝 stick', `${validQian(61, 'mazu')} ${validQian(100, 'guandi')}`, 'false true')

// ── 姓名亭 ─────────────────────────────────────────────────────────────────
// Strokes are the 康熙 convention every 姓名學 table prints; the five grids
// are arithmetic on them (single/double surname, single/double given name).
console.log('\n姓名 (lib/names):')
const strokesOf = (s: string) => [...s].map(c => charInfo(c)!.strokes).join(' ')
eq('陳林張李黃蔡許鄭謝洪', strokesOf('陳林張李黃蔡許鄭謝洪'), '16 8 11 7 12 17 11 19 17 10')
eq('氵艹阝 radicals at full form: 江 蘇 邱 陽', strokesOf('江蘇邱陽'), '7 22 12 17')
eq('numerals by value: 一 四 十', strokesOf('一四十'), '1 4 10')
const wdm = nameChart('王', '大明')
eq('王大明 五格', Object.values(wdm.ge).map(g => `${g.label}${g.n}`).join(' '), '天格5 人格7 地格11 外格9 總格15')
eq('  三才', `${wdm.sancai.tian}${wdm.sancai.ren}${wdm.sancai.di} ${wdm.sancai.tianRen}/${wdm.sancai.renDi}`, '土金木 相生/相剋')
const oy = nameChart('歐陽', '菲')
eq('歐陽菲 五格 (double surname, single given)', Object.values(oy.ge).map(g => `${g.label}${g.n}`).join(' '), '天格32 人格31 地格15 外格16 總格46')
const lin = nameChart('林', '安')
eq('林安 五格 (single/single → 外格 2)', Object.values(lin.ge).map(g => `${g.label}${g.n}`).join(' '), '天格9 人格14 地格7 外格2 總格14')
eq('81 數理 wraps: 81 還元 吉, 82 → 2 凶', `${shuli(81).name}${shuli(81).luck} ${shuli(82).n}${shuli(82).luck}`, '還元吉 2凶')
eq('測字 facts: 林 is 木部 8 畫', `${charInfo('林')!.radical} ${charInfo('林')!.strokes}`, '木 8')

// ── 四面佛 ─────────────────────────────────────────────────────────────────
// 流年 2026 丙午 against the 1990-01-01 chart (日主 丙, 日支 寅, 年支 巳):
// 丙 vs 丙 = 比肩; 午 vs 寅 = 三合 (寅午戌); 午 vs 巳 = 無特殊關係.
console.log('\n四面佛 (流年):')
const ln = liuNian(baziChart({ y: 1990, m: 1, d: 1, h: 15, mi: 25, gender: 'male' }), 1990, 2026)
eq('2026 流年', `${ln.ganZhi} ${ln.shiShen} 日支${ln.dayBranch.kind} 年支${ln.yearBranch.kind} ${ln.taiSui}`, '丙午 比肩 日支三合 年支無特殊關係 無')
eq('wishes: at least one face required', `${validWishes({ pledge: 'x' })} ${validWishes({ career: '升遷' })}`, 'false true')

// ── 九曜廟 ─────────────────────────────────────────────────────────────────
// Reference values are Swiss Ephemeris (pyswisseph, SIDM_LAHIRI, mean node,
// whole-sign Asc), observed 2026-09-01. Our engine agreed within 15" on all
// four charts; the tolerance here is 60" — a twentieth of a pada — so a
// silent slip of a 宿 or a sign fails loudly while ephemeris noise passes.
console.log('\n九曜 (lib/jyotish vs Swiss Ephemeris):')
const SWE: Array<{ label: string; in: any; ayan: number; pos: Record<string, number>; asc: number }> = [
  { label: '1990-01-01 15:25 台北', in: { y: 1990, m: 1, d: 1, h: 15, mi: 25, lat: 25.0330, lon: 121.5654, tz: 'Asia/Taipei', place: '台北' },
    ayan: 23.717418, pos: { Sun: 256.8989, Moon: 306.9782, Mars: 226.145, Mercury: 272.0047, Jupiter: 71.4537, Venus: 282.5252, Saturn: 261.9142, Rahu: 294.7244 }, asc: 52.2588 },
  { label: '1985-07-20 09:00 東京', in: { y: 1985, m: 7, d: 20, h: 9, mi: 0, lat: 35.6895, lon: 139.6917, tz: 'Asia/Tokyo', place: '東京' },
    ayan: 23.655224, pos: { Sun: 93.5782, Moon: 118.6247, Mars: 93.0008, Mercury: 119.1168, Jupiter: 290.335, Venus: 51.2744, Saturn: 207.8429, Rahu: 20.9058 }, asc: 145.8919 },
  { label: '2000-02-04 21:30 新德里', in: { y: 2000, m: 2, d: 4, h: 21, mi: 30, lat: 28.6139, lon: 77.2090, tz: 'Asia/Kolkata', place: '新德里' },
    ayan: 23.858399, pos: { Sun: 291.2858, Moon: 281.4402, Mars: 330.5021, Mercury: 305.0109, Jupiter: 4.5904, Venus: 259.4674, Saturn: 16.9446, Rahu: 99.3769 }, asc: 157.3286 },
  { label: '1975-11-30 04:10 高雄', in: { y: 1975, m: 11, d: 30, h: 4, mi: 10, lat: 22.6273, lon: 120.3014, tz: 'Asia/Taipei', place: '高雄' },
    ayan: 23.520608, pos: { Sun: 223.4598, Moon: 180.7734, Mars: 65.2741, Mercury: 223.9919, Jupiter: 351.4219, Venus: 178.3167, Saturn: 99.2419, Rahu: 207.4462 }, asc: 193.7725 },
]
const arcsec = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180) * 3600
for (const c of SWE) {
  const ch = jyotishChart(c.in)
  let worst = arcsec(ch.lagna.lon, c.asc)
  for (const g of ch.grahas) if (g.graha !== 'Ketu') worst = Math.max(worst, arcsec(g.lon, c.pos[g.graha]))
  eq(`${c.label} — worst Δ vs Swiss Ephemeris ≤ 60"`, String(worst <= 60), 'true')
  eq('  ayanamsa', ch.ayanamsa.toFixed(4), c.ayan.toFixed(4))
}
// Frozen derived values for the first chart: the parts a reader sees.
const j = jyotishChart(SWE[0].in)
eq('台北 1990 — Lagna', `${RASI[j.lagna.rasi][1]} ${j.lagna.deg.toFixed(2)} ${NAKSHATRA[j.lagna.nakshatra][0]}-${j.lagna.pada}`, '金牛 22.26 Rohini-4')
eq('  Moon nakshatra', NAKSHATRA[j.moonNakshatra][0], 'Shatabhisha')
eq('  dasha lords from birth', j.dasha.maha.slice(0, 4).map(p => p.lord).join(' '), 'Rahu Jupiter Saturn Mercury')
eq('  Saturn mahadasha starts', j.dasha.maha[2].from.toISOString().slice(0, 10), '2023-07-30')
eq('  Lahiri at J2000', lahiriAyanamsa(new Date('2000-01-01T12:00:00Z')).toFixed(4), '23.8571')

console.log(failures === 0 ? '\nall golden charts hold' : `\n${failures} FAILURE(S) — a library upgrade changed the 排盤. Do not ship until resolved.`)
process.exit(failures === 0 ? 0 : 1)
