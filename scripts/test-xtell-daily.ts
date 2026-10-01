// scripts/test-xtell-daily.ts — the free daily fortune (TODO item 2).
// Real time, BaZi and Western code; the four routes run for real with auth,
// the service-role database (supabase/109's functions mirrored in memory;
// the SQL itself is proven on Postgres separately) and the model faked. No
// network, no provider, no credits.   npx tsx scripts/test-xtell-daily.ts
//
// Independent expectations: Codex's boundary fixtures (Taipei/Seoul/LA
// dates, LA 2025–26 DST, 2026 立春 at 04:02:08 library time), tzdata
// history (Taiwan skipped 1974-04-01 00:00), and hand-read pillars.

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveWallTime, birthInstant, localDateIn, dayAnchor, validZone } from '../lib/xtell-time'
import * as xtell from '../lib/xtell'
import * as daily from '../lib/xtell-daily'
import * as time from '../lib/xtell-time'
import * as places from '../lib/xtell-places'
import { rememberedBirth, momentProblem, birthProblem } from '../lib/xtell-birth'
import { STRINGS } from '../lib/i18n'
import * as catalog from '../lib/xtell-catalog'
import * as presets from '../lib/xtell-presets'

const { baziNatalZoned, liuRi, civilDay } = xtell
const { dailyBases, westernFacts, profileProblem, parseDailyReading, dailyBrief, DAILY_RULES } = daily

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const

// ── Time ───────────────────────────────────────────────────────────────────
{
  const fx = JSON.parse(fs.readFileSync('/Users/cwei/Documents/ModelXD_ChatGPT/output/xtell-todo-2026-09-27/daily-boundary-cases.json', 'utf8'))
  check('Codex date boundaries: Taipei, Seoul, Los Angeles', fx.dateBoundaries.every((c: any) => localDateIn(c.zone, Date.parse(c.at)) === c.date))
  check('LA 2026-03-08 02:30 never existed; 2026-11-01 01:30 happened twice', resolveWallTime(2026, 3, 8, 2, 30, 'America/Los_Angeles').kind === 'gap' && resolveWallTime(2026, 11, 1, 1, 30, 'America/Los_Angeles').kind === 'ambiguous')
  const amb = resolveWallTime(2026, 11, 1, 1, 30, 'America/Los_Angeles') as { kind: 'ambiguous'; utc: [number, number] }
  check('the two instants are an hour apart, and fold picks between them', amb.utc[1] - amb.utc[0] === 3600_000 && (birthInstant(2026, 11, 1, 1, 30, 'America/Los_Angeles', 1) as any).utc === amb.utc[1] && !birthInstant(2026, 11, 1, 1, 30, 'America/Los_Angeles').ok)
  const [s, e] = civilDay(1974, 4, 1, 'Asia/Taipei')
  check('Taiwan skipped 1974-04-01 00:00: that day starts 01:00 and lasts 23 hours', new Date(s).toISOString() === '1974-03-31T16:00:00.000Z' && (e - s) / 3600_000 === 23)
  check('the day anchor is local noon in the chosen zone', new Date(dayAnchor('2026-09-27', 'Asia/Taipei')).toISOString() === '2026-09-27T04:00:00.000Z' && new Date(dayAnchor('2026-09-27', 'Asia/Seoul')).toISOString() === '2026-09-27T03:00:00.000Z')
  check('zones: real IANA names only', validZone('Asia/Taipei') && !validZone('Mars/Olympus') && !validZone('') && !validZone(42))
}

// ── BaZi, zone-aware ───────────────────────────────────────────────────────
{
  const at = (tz: string) => { const i = birthInstant(2026, 2, 4, 4, 30, tz); return i.ok ? i.utc : null }
  const seoul = baziNatalZoned({ y: 2026, m: 2, d: 4, h: 4, mi: 30 }, 'Asia/Seoul', at('Asia/Seoul'))
  const taipei = baziNatalZoned({ y: 2026, m: 2, d: 4, h: 4, mi: 30 }, 'Asia/Taipei', at('Asia/Taipei'))
  check('2026-02-04 04:30: Seoul is before 立春 (乙巳/己丑), Taipei after (丙午/庚寅)', seoul.pillars.year === '乙巳' && seoul.pillars.month === '己丑' && taipei.pillars.year === '丙午' && taipei.pillars.month === '庚寅', JSON.stringify([seoul.pillars, taipei.pillars]))
  const unknown = baziNatalZoned({ y: 2026, m: 2, d: 4, h: 12, mi: 0, hourUnknown: true }, 'Asia/Seoul', null)
  check('hour unknown on 立春 day: year and month are both kept, undecided', same(unknown.pillars.year, ['乙巳', '丙午']) && same(unknown.pillars.month, ['己丑', '庚寅']) && unknown.pillars.time === null)
  // Tokyo 00:30 is 23:30 the day before on the library's clock: the day
  // master must be the LOCAL day's stem.
  const i = birthInstant(2026, 2, 5, 0, 30, 'Asia/Tokyo')
  const tokyo = baziNatalZoned({ y: 2026, m: 2, d: 5, h: 0, mi: 30 }, 'Asia/Tokyo', i.ok ? i.utc : null)
  const localDay = xtell.baziChart({ y: 2026, m: 2, d: 5, h: 0, mi: 30, gender: 'male' }).pillars.day.ganZhi
  check('near midnight the day master is the local day\'s stem', tokyo.pillars.day === localDay && tokyo.dayMaster === localDay[0])
  const d = liuRi(tokyo, '2026-09-27', 'Asia/Tokyo', dayAnchor('2026-09-27', 'Asia/Tokyo'))
  // The 十神 table by hand: the relation of today's stem to the day master
  // (same element 比肩/劫財, produced 食神/傷官, controlled 偏財/正財,
  // controlling 七殺/正官, producing 偏印/正印; same polarity first).
  const STEMS = '甲乙丙丁戊己庚辛壬癸', EL = (g: string) => Math.floor(STEMS.indexOf(g) / 2), YANG = (g: string) => STEMS.indexOf(g) % 2 === 0
  const godOf = (dm: string, g: string) => {
    const k = (EL(g) - EL(dm) + 5) % 5, samePolarity = YANG(g) === YANG(dm)
    return [['比肩', '劫財'], ['食神', '傷官'], ['偏財', '正財'], ['七殺', '正官'], ['偏印', '正印']][k][samePolarity ? 0 : 1]
  }
  check('流日 十神 read against the LOCAL day master', d.dayShiShen === godOf(tokyo.dayMaster, d.day[0]) && d.monthShiShen === godOf(tokyo.dayMaster, d.month[0]) && d.yearShiShen === godOf(tokyo.dayMaster, d.year[0]), `${tokyo.dayMaster} ${d.day} ${d.dayShiShen}`)
  const rel = liuRi(unknown, '2026-09-27', 'Asia/Seoul', dayAnchor('2026-09-27', 'Asia/Seoul')).relations
  check('undecided pillars give relations for both, marked undecided', rel.filter(r => r.with === 'year').length === 2 && rel.filter(r => r.with === 'year').every(r => r.undecided) && !rel.some(r => r.with === 'time'))
}

// ── Western ────────────────────────────────────────────────────────────────
{
  const now = Date.UTC(2026, 8, 27, 3, 0)
  const known: daily.DailyProfile = { birth: { y: 1990, m: 1, d: 1, h: 15, mi: 0 }, place: 'taipei', fold: null, displayTz: 'Asia/Taipei', revision: 1 }
  const unk: daily.DailyProfile = { ...known, birth: { y: 1990, m: 1, d: 1, h: 12, mi: 0, hourUnknown: true } }
  const k = dailyBases(known, now).western, u = dailyBases(unk, now).western
  check('known hour: at most 8 contacts, Moon never carries a date, dates only near the day', k.contacts.length <= 8 && k.contacts.every(c => (c.transit !== 'Moon' || c.exact === null) && (!c.exact || Math.abs(Date.parse(c.exact) - Date.parse(k.date)) <= 2 * 86400_000)) && k.contacts.every(c => !c.approx))
  check('hour unknown: every contact approximate, no dates, no natal Moon or angles', u.contacts.length > 0 && u.contacts.every(c => c.approx && c.exact === null && !['Moon', 'ASC', 'MC', 'Fortune'].includes(c.natal)))
  const uf = westernFacts(u)
  check('unknown-hour facts give no orb figures', !/差 \d/.test(uf) && uf.includes('只是可能'), uf)
  const none = westernFacts({ ...k, contacts: [] })
  check('no contacts: no "calm day", no event conclusion', !/平穩|平靜的一天|calm|quiet/i.test(none.replace('不代表生活平靜', '')) && none.includes('不代表生活平靜或有事'), none)
  check('each method\'s basis holds only that method', !('bazi' in (dailyBases(known, now) as any).western))
  // Born in a zone, no city (owner, Sep 27): the planets only.
  const zoned: daily.DailyProfile = { ...known, place: 'tz:Asia/Taipei' }
  const z = dailyBases(zoned, now)
  check('zone only: no rising sign, midheaven or Fortune contacts; the rest as with the city', z.western.noPlace === true && z.western.contacts.every(c => !['ASC', 'MC', 'Fortune'].includes(c.natal)) &&
    JSON.stringify(z.western.contacts) === JSON.stringify(k.contacts.filter(c => !['ASC', 'MC', 'Fortune'].includes(c.natal)).concat(z.western.contacts.slice(k.contacts.filter(c => !['ASC', 'MC', 'Fortune'].includes(c.natal)).length))))
  check('zone only: the facts say the planets only, no houses', westernFacts(z.western).includes('只看行星') && !westernFacts(k).includes('只看行星'))
  check('zone only: the BaZi day is the same as with the city in that zone', JSON.stringify(z.bazi) === JSON.stringify(dailyBases(known, now).bazi))
  check('hour unknown and zone only: approximate as before, not "no place"', !dailyBases({ ...unk, place: 'tz:Asia/Taipei' }, now).western.noPlace)
}

// ── Profile checks ─────────────────────────────────────────────────────────
{
  const p = (b: any, extra: any = {}) => profileProblem({ birth: b, place: 'taipei', displayTz: 'Asia/Taipei', ...extra })
  check('no gender is asked for', p({ y: 1990, m: 1, d: 1, h: 15, mi: 0 }) === null && birthProblem({ y: 1990, m: 1, d: 1, h: 15, mi: 0 }) === 'shape' && momentProblem({ y: 1990, m: 1, d: 1, h: 15, mi: 0 }) === null)
  check('the temples still need gender (unchanged)', birthProblem({ y: 1990, m: 1, d: 1, h: 15, mi: 0, gender: 'male' }) === null)
  check('impossible and future dates are refused', p({ y: 1990, m: 2, d: 31, h: 1, mi: 0 }) === 'birth_date' && p({ y: 2099, m: 1, d: 1, h: 1, mi: 0 }) === 'birth_future')
  const la = (h: number, mi: number, y: number, m: number, d: number, fold?: number) => profileProblem({ birth: { y, m, d, h, mi }, place: 'la', displayTz: 'Asia/Taipei', ...(fold !== undefined ? { fold } : {}) })
  check('a DST gap is refused, a repeat needs a choice', la(2, 30, 2025, 3, 9) === 'birth_time_gap' && la(1, 30, 2025, 11, 2) === 'birth_time_ambiguous' && la(1, 30, 2025, 11, 2, 1) === null && la(1, 30, 2025, 11, 2, 7) === 'fold_invalid')
  check('unknown hour needs no time checks', profileProblem({ birth: { y: 2025, m: 3, d: 9, h: 2, mi: 30, hourUnknown: true }, place: 'la', displayTz: 'Asia/Taipei' }) === null)
  check('place and zone must be real', p({ y: 1990, m: 1, d: 1, h: 1, mi: 0 }, { place: 'atlantis' }) === 'place_invalid' && p({ y: 1990, m: 1, d: 1, h: 1, mi: 0 }, { displayTz: 'Mars/Olympus' }) === 'tz_invalid')
  check('a birth zone of its own, no city: real zones only', p({ y: 1990, m: 1, d: 1, h: 1, mi: 0 }, { place: 'tz:Asia/Tokyo' }) === null && p({ y: 1990, m: 1, d: 1, h: 1, mi: 0 }, { place: 'tz:Mars/Olympus' }) === 'place_invalid' && p({ y: 1990, m: 1, d: 1, h: 1, mi: 0 }, { place: 'tz:' }) === 'place_invalid')
  check('a birth zone applies DST like a city there', profileProblem({ birth: { y: 2025, m: 3, d: 9, h: 2, mi: 30 }, place: 'tz:America/Los_Angeles', displayTz: 'Asia/Taipei' }) === 'birth_time_gap' && profileProblem({ birth: { y: 2025, m: 11, d: 2, h: 1, mi: 30 }, place: 'tz:America/Los_Angeles', displayTz: 'Asia/Taipei' }) === 'birth_time_ambiguous')
}

// ── 占星塔's remembered birth keeps an unknown hour ─────────────────────────
{
  const r = rememberedBirth(JSON.stringify({ y: 1990, m: 5, d: 6, h: 9, mi: 30, gender: 'female', hourUnknown: true, place: 'tokyo' }))
  check('remembered birth: unknown hour survives the restore', !!r && r.hourUnknown === true && r.h === 12 && r.mi === 0 && r.place === 'tokyo' && r.gender === 'female')
  check('remembered birth: a known time comes back as given', rememberedBirth(JSON.stringify({ y: 1990, m: 5, d: 6, h: 9, mi: 30 }))?.h === 9)
  check('remembered birth: garbage or impossible dates give nothing', rememberedBirth('{bad') === null && rememberedBirth(JSON.stringify({ y: 1990, m: 2, d: 31, h: 1, mi: 0 })) === null && rememberedBirth(null) === null)
}

// ── Words ──────────────────────────────────────────────────────────────────
{
  const b = dailyBrief('western', 'ja')
  check('the brief: facts only, no scores, no calm-day claim, the chosen language', b.includes('Use ONLY the facts') && b.includes('never call the day calm') && b.includes('Japanese') && /No scores/.test(b))
  check('a reading needs all four parts', !!parseDailyReading('{"summary":"s","themes":["a","b"],"reflect":"r","why":"w"}') && parseDailyReading('{"summary":"s","themes":[],"reflect":"r","why":"w"}') === null && parseDailyReading('no json') === null)
  check('rules versions per method', DAILY_RULES.western !== DAILY_RULES.bazi)
  const keys = Object.keys(STRINGS).filter(k => k.startsWith('xtell.dy.') || k.startsWith('xtell.pl.') || k.startsWith('xtell.sign.') || k.startsWith('xtell.asp.') || k.startsWith('xtell.rel.') || k.startsWith('xtell.god.'))
  check('daily strings in all five languages', keys.length >= 100 && keys.every(k => LANGS.every(l => typeof (STRINGS as any)[k][l] === 'string' && (STRINGS as any)[k][l].trim())), String(keys.length))
  check('user copy has no engine, library or source wording', !keys.some(k => /lunar-typescript|astronomy-engine|Swiss|library|engine|ephemeris/i.test(JSON.stringify((STRINGS as any)[k]))))
  check('the delete confirmation names what goes, and what does not', LANGS.every(l => (STRINGS as any)['xtell.dy.deleteConfirm'][l].length > 20) && /birth details/.test((STRINGS as any)['xtell.dy.deleteConfirm'].en) && /paid conversations/.test((STRINGS as any)['xtell.dy.deleteConfirm'].en) && /other temple visits are not affected/.test((STRINGS as any)['xtell.dy.deleteConfirm'].en) && /cannot be undone/.test((STRINGS as any)['xtell.dy.deleteConfirm'].en))
  check('catalog: daily is live and free', catalog.liveFeature('daily')?.opens === 'daily' && catalog.XTELL_CATALOG_VERSION === '2026-09-29.5')
  const qwen = (name: string) => ({ provider: 'alibaba', model_name: name, output_config: { text: { thinking_levels: ['thinking_true', 'thinking_false'] } } })
  check('Qwen starts with thinking off, Flash too (Sep 29); others keep their own default', presets.defaultThinking(qwen('qwen3.8-flash')) === 'thinking_false' && presets.defaultThinking(qwen('qwen3.8-max')) === 'thinking_false' && presets.defaultThinking({ provider: 'openai', model_name: 'gpt-6-luna' }) === null)
  {
    // The estimate (Sep 29): a tester was quoted $0.0008 and charged $0.0047.
    const flash = { provider: 'alibaba', model_name: 'qwen3.8-flash', model_pricing: { tokens: { text_input: 0.15, text_output: 0.47 } }, output_config: { text: { thinking_levels: ['thinking_true', 'thinking_false'] } } }
    const off = presets.estimateReadingUsd(flash, { thinking: 'thinking_false', search: false }, 0)!
    const on = presets.estimateReadingUsd(flash, { thinking: 'thinking_true', search: false }, 0)!
    const at = (inTok: number, outTok: number) => (inTok * 0.15 + outTok * 0.47) / 1e6
    check('estimate, thinking off: near the measured answers after the length rule (at most 15% under, 40% over)', [at(2819, 1041), at(1714, 1085), at(3934, 1148)].every(real => off >= real * 0.85 && off <= real * 1.4), String(off))
    check('estimate, thinking on: above a median thinking answer, and more than 2x off', on > at(3000, 3938) && on > 2 * off && on < 0.005, String(on))
    check('Auto (the provider default) and the lowest levels add no thinking', presets.reasons(null) === false && ['none', 'minimal', 'low', 'thinking_false'].every(l => !presets.reasons(l)) && presets.reasons('high') && presets.reasons('max'))
  }
  check('presets moved, not changed: deep is GPT-6 Astra only', same(presets.PRESETS.find(p => p.key === 'deep')?.models, ['gpt-6-astra']))
}

// ── Routes ─────────────────────────────────────────────────────────────────
function loadRoute(file: string, modules: Record<string, unknown>) {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports: any = {}
  vm.runInNewContext(js, {
    exports, console: { ...console, warn: () => {} }, process, Response, Request, ReadableStream, TextEncoder, crypto: globalThis.crypto,
    require: (name: string) => { if (!(name in modules)) throw new Error('unexpected route dependency: ' + name); return modules[name] },
  }, { filename: file })
  return exports
}

// ── The writer streams (Sep 29) ────────────────────────────────────────────
async function writerStreams() {
  const load = (qwen: (cb: any) => void, stand: string | null) => {
    const houseCalls: any[] = []
    const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'lib/xtell-daily-model.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    const exports: any = {}
    const modules: Record<string, unknown> = {
      '@/lib/providers': { streamText: async (_m: unknown, _msgs: unknown, cb: any) => { qwen(cb) } },
      '@/lib/models': { getModelByProviderName: async () => ({ enabled: true }) },
      '@/lib/house-llm': { houseCall: async (o: any) => { houseCalls.push(o); return { content: stand === null ? [] : [{ type: 'text', text: stand }] } } },
    }
    vm.runInNewContext(js, { exports, console: { ...console, warn: () => {} }, process, setTimeout, clearTimeout, require: (n: string) => modules[n] }, { filename: 'xtell-daily-model.ts' })
    return { dailyText: exports.dailyText, houseCalls }
  }
  const good = '{"note":"好"}', ok = (t: string) => t === good
  const run = async (qwen: (cb: any) => void, stand: string | null) => {
    const w = load(qwen, stand), seen: string[] = []
    const text = await w.dailyText({ system: 's', content: 'c', userId: 'u', accept: ok, onDelta: (d: string) => seen.push(d), onRestart: () => seen.push('<restart>') })
    return { text, seen, house: w.houseCalls.length }
  }
  const a = await run(cb => { cb.onDelta('{"note"'); cb.onDelta(':"好"}'); cb.onDone() }, 'unused')
  check('writer: Qwen\'s words pass through as they come; no stand-in', a.text === good && a.seen.join('|') === '{"note"|:"好"}' && a.house === 0)
  const b = await run(cb => { cb.onDelta('{"note":"lucky 7"}'); cb.onDone() }, good)
  check('writer: a turned-down reply says restart, then the stand-in\'s whole reply', b.text === good && b.seen.join('|') === '{"note":"lucky 7"}|<restart>|' + good && b.house === 1)
  const c = await run(cb => { cb.onError(new Error('down')); cb.onDelta('late words') }, good)
  check('writer: nothing streamed before a failure, no restart; late words never reach the page', c.text === good && c.seen.join('|') === good && c.house === 1)
  const d = await run(cb => { cb.onDelta('{"no'); cb.onError(new Error('down')) }, null)
  check('writer: both fail: restart, then nothing more, null', d.text === null && d.seen.join('|') === '{"no|<restart>' && d.house === 1)
}

/** supabase/109 in memory: the same outcomes as the SQL (proven on PGlite). */
function fakeDb() {
  let seq = 0
  const profiles = new Map<string, any>(), dailyRows: any[] = [], readings: any[] = [], calls: any[] = []
  let missing = false
  const rpc = async (name: string, a: any) => {
    calls.push({ name, a })
    if (missing) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    if (name === 'xtell_profile_save') {
      const p = profiles.get(a.p_user)
      if (!p) {
        if (a.p_consent !== true) return { data: null, error: null }
        profiles.set(a.p_user, { birth: a.p_birth, birth_place: a.p_place, fold: a.p_fold, display_tz: a.p_tz, revision: ++seq, consent_at: new Date().toISOString() })
        return { data: seq, error: null }
      }
      if (JSON.stringify([p.birth, p.birth_place, p.fold]) !== JSON.stringify([a.p_birth, a.p_place, a.p_fold])) p.revision = ++seq
      Object.assign(p, { birth: a.p_birth, birth_place: a.p_place, fold: a.p_fold, display_tz: a.p_tz })
      return { data: p.revision, error: null }
    }
    if (name === 'xtell_profile_delete') { profiles.delete(a.p_user); for (const l of [dailyRows, readings]) for (let i = l.length - 1; i >= 0; i--) if (l[i].user_id === a.p_user && (l === dailyRows || l[i].temple === 'daily')) l.splice(i, 1); return { data: null, error: null } }
    if (name === 'xtell_daily_claim') {
      const p = profiles.get(a.p_user)
      if (!p || p.revision !== a.p_revision) return { data: [{ outcome: 'gone', row_id: null, basis: null, reading: null }], error: null }
      const row = dailyRows.find(r => r.user_id === a.p_user && r.local_date === a.p_date && r.display_tz === a.p_tz && r.profile_revision === a.p_revision && r.method === a.p_method && r.rules_version === a.p_rules && r.lang === a.p_lang)
      if (row?.status === 'ready') return { data: [{ outcome: 'ready', row_id: row.id, basis: row.basis, reading: row.reading }], error: null }
      if (row?.status === 'pending') return { data: [{ outcome: 'pending', row_id: row.id, basis: null, reading: null }], error: null }
      if (row) { row.status = 'pending'; row.lease_token = a.p_token; return { data: [{ outcome: 'claimed', row_id: row.id, basis: null, reading: null }], error: null } }
      const r = { id: randomUUID(), user_id: a.p_user, local_date: a.p_date, display_tz: a.p_tz, profile_revision: a.p_revision, method: a.p_method, rules_version: a.p_rules, lang: a.p_lang, status: 'pending', lease_token: a.p_token }
      dailyRows.push(r)
      return { data: [{ outcome: 'claimed', row_id: r.id, basis: null, reading: null }], error: null }
    }
    if (name === 'xtell_daily_finish') {
      const p = profiles.get(a.p_user)
      const row = dailyRows.find(r => r.id === a.p_id && r.user_id === a.p_user && r.lease_token === a.p_token && r.status === 'pending')
      if (!p || p.revision !== a.p_revision || !row) return { data: false, error: null }
      Object.assign(row, { status: a.p_ok ? 'ready' : 'failed', basis: a.p_basis, reading: a.p_ok ? a.p_reading : null, lease_token: null })
      return { data: true, error: null }
    }
    if (name === 'xtell_daily_followup') {
      if (!profiles.get(a.p_user)) return { data: null, error: null }
      const d = dailyRows.find(r => r.id === a.p_daily && r.user_id === a.p_user && r.status === 'ready')
      if (!d) return { data: null, error: null }
      const r = { id: randomUUID(), user_id: a.p_user, temple: 'daily', subject: { dailyId: d.id, method: d.method, date: d.local_date }, chart: { basis: d.basis, reading: d.reading }, turns: [] }
      readings.push(r)
      return { data: r.id, error: null }
    }
    throw new Error('unexpected rpc ' + name)
  }
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = []
    const q: any = {
      select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q }, is: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => {
        if (missing) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.xtell_profiles'" } }
        calls.push({ name: 'select', table, filters: [...filters] })
        if (table === 'xtell_profiles') { const uid = filters.find(f => f[0] === 'user_id')?.[1] as string; return { data: profiles.get(uid) ?? null, error: null } }
        if (table === 'xtell_daily') return { data: dailyRows.find(r => filters.every(([k, v]) => r[k] === v)) ?? null, error: null }
        if (table === 'xtell_readings') return { data: readings.find(r => filters.every(([k, v]) => r[k] === v)) ?? null, error: null }
        return { data: null, error: null }
      },
    }
    return q
  }
  return { admin: { rpc, from }, profiles, dailyRows, readings, calls, setMissing: (v: boolean) => { missing = v } }
}

async function routes() {
  const db = fakeDb()
  let user: { id: string } | null = { id: 'user-a' }
  const rpcCalls: Array<{ name: string; a: any }> = []
  const session = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => db.admin.from(t),
    rpc: async (name: string, a: any) => { rpcCalls.push({ name, a }); return { error: null } },
  }
  const houseCalls: any[] = []
  let reply: string | (() => never) = JSON.stringify({ summary: 's', themes: ['a', 'b'], reflect: 'r', why: 'w' })
  const house = { houseCall: async (o: any) => { houseCalls.push(o); if (typeof reply === 'function') reply(); return { content: [{ type: 'text', text: reply }] } } }
  const common = { '@/lib/supabase-server': { createSupabaseServer: async () => session }, '@/lib/xtell-admin': { xtellAdmin: () => db.admin, dailyMissing: (e: any) => !!e && /PGRST20[25]|42P01/.test(e.code) } }
  const profileRoute = loadRoute('app/api/xtell/profile/route.ts', { ...common, '@/lib/xtell-daily': daily, '@/lib/xtell-time': time, '@/lib/xtell-places': places })
  // The writer (lib/xtell-daily-model.ts: Qwen, then the stand-in), recorded
  // in the same shape the house call had.
  // Streamed in two pieces when the route listens (Sep 29).
  const writer = { dailyText: async (o: any) => {
    const r = await house.houseCall({ system: o.system, messages: [{ role: 'user', content: o.content }] }); const text = r.content[0].text as string
    if (!o.accept(text)) return null
    o.onDelta?.(text.slice(0, 9)); o.onDelta?.(text.slice(9))
    return text
  } }
  const afters: Promise<unknown>[] = []
  const dailyRoute = loadRoute('app/api/xtell/daily/route.ts', {
    ...common, '@/lib/xtell-daily-model': writer, '@/lib/xtell-daily': daily,
    'next/server': { after: (p: Promise<unknown>) => { afters.push(p) } }, '@/lib/partial-json': require('../lib/partial-json'), '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/xtell-personality': require('../lib/xtell-personality'),
  })
  const followRoute = loadRoute('app/api/xtell/daily/followup/route.ts', common)
  const req = (url: string, method: string, body?: unknown, ip = '10.0.0.1') => new Request(url, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const json = async (r: Response) => ({ status: r.status, d: await r.json() as any })
  const birth = { y: 1990, m: 1, d: 1, h: 15, mi: 0 }

  user = null
  check('signed out: profile and daily say 401', (await profileRoute.GET()).status === 401 && (await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', {}))).status === 401)
  user = { id: 'user-a' }
  check('no profile yet', (await json(await profileRoute.GET())).d.profile === null && (await json(await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant' })))).d.profile === null)
  check('no profile yet, asked for a stream: still one plain answer', (await json(await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant', stream: true }, '10.0.0.2')))).d.profile === null)
  const noConsent = await json(await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth, place: 'taipei', displayTz: 'Asia/Taipei' })))
  check('first save without consent: refused, nothing stored', noConsent.status === 400 && noConsent.d.code === 'consent_required' && db.profiles.size === 0)
  const bad = await json(await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth: { ...birth, d: 31, m: 2 }, place: 'taipei', displayTz: 'Asia/Taipei', consent: true })))
  check('an impossible date is refused with its code', bad.status === 400 && bad.d.code === 'birth_date')
  const saved = await json(await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth: { ...birth, gender: 'male' }, place: 'taipei', displayTz: 'Asia/Taipei', consent: true, fold: 1, user_id: 'user-b' })))
  check('saved with consent, for the SESSION user only; no gender kept; fold dropped when the time did not repeat', saved.status === 200 && db.profiles.has('user-a') && !db.profiles.has('user-b') && !('gender' in db.profiles.get('user-a').birth) && db.profiles.get('user-a').fold === null)
  const la = await json(await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth: { y: 2025, m: 11, d: 2, h: 1, mi: 30 }, place: 'la', displayTz: 'America/Los_Angeles', fold: 1 })))
  check('an edit needs no new consent; a repeated hour keeps its fold', la.status === 200 && db.profiles.get('user-a').fold === 1 && db.profiles.get('user-a').revision > saved.d.profile.revision)
  const zoneLa = await json(await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth: { y: 2025, m: 11, d: 2, h: 1, mi: 30 }, place: 'tz:America/Los_Angeles', displayTz: 'America/Los_Angeles', fold: 0 })))
  check('a birth zone with no city saves as given; a repeated hour there keeps its fold', zoneLa.status === 200 && db.profiles.get('user-a').birth_place === 'tz:America/Los_Angeles' && db.profiles.get('user-a').fold === 0 && zoneLa.d.profile.place === 'tz:America/Los_Angeles')
  const zoneDay = await json(await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant' })))
  check('the daily route reads a zone-only profile: both methods, the Western one planets only', zoneDay.status === 200 && !!zoneDay.d.methods?.western && !!zoneDay.d.methods?.bazi)
  await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth, place: 'taipei', displayTz: 'Asia/Taipei' }))

  houseCalls.length = 0
  const d1 = await json(await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant' })))
  check('today: both methods written once each, free, with their own basis', d1.status === 200 && d1.d.methods.western.status === 'ready' && d1.d.methods.bazi.status === 'ready' && houseCalls.length === 2
    && !!d1.d.methods.western.basis.western && !d1.d.methods.western.basis.bazi && !!d1.d.methods.bazi.basis.bazi && !d1.d.methods.bazi.basis.western, JSON.stringify(d1.d).slice(0, 300))
  check('the writer got that method\'s facts and brief only', houseCalls.some(c => c.system.includes('Western astrology') && c.messages[0].content.includes('行運')) && houseCalls.some(c => c.system.includes('BaZi') && c.messages[0].content.includes('流日')))
  const d2 = await json(await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant' })))
  check('reopened the same day: the same reading, no new writing', houseCalls.length === 2 && same(d2.d.methods.western.reading, d1.d.methods.western.reading) && d2.d.methods.western.id === d1.d.methods.western.id)
  await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'ja' }))
  check('another language is its own reading', houseCalls.length === 4)
  await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth: { ...birth, h: 16 }, place: 'taipei', displayTz: 'Asia/Taipei' }))
  await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant' }))
  check('an edited birth is a new reading', houseCalls.length === 6)
  reply = 'Sure! Here is your day.'
  await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth: { ...birth, h: 17 }, place: 'taipei', displayTz: 'Asia/Taipei' }))
  const d3 = await json(await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant' })))
  check('unreadable writing: "failed" with the basis still there, no paid fallback', d3.d.methods.western.status === 'failed' && !!d3.d.methods.western.basis && d3.d.methods.western.reading === undefined)
  reply = () => { throw new Error('provider down with secret text') }
  await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth: { ...birth, h: 18 }, place: 'taipei', displayTz: 'Asia/Taipei' }))
  const d4 = await json(await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant' })))
  check('provider down: "failed", basis shown', d4.d.methods.bazi.status === 'failed' && !!d4.d.methods.bazi.basis)
  reply = JSON.stringify({ summary: 's', themes: ['a'], reflect: 'r', why: 'w' })

  // Streaming (Sep 29): each card shows its basis at once and its words as
  // they are written; the checked reading still comes last. An older page
  // that does not ask for a stream gets one JSON answer (all of the above).
  await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth: { ...birth, h: 19 }, place: 'taipei', displayTz: 'Asia/Taipei' }))
  houseCalls.length = 0
  // Its own address: the route allows twelve a minute from one.
  const sres = await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant', stream: true }, '10.0.0.2'))
  const events: any[] = (await sres.text()).trim().split('\n').map((l: string) => JSON.parse(l))
  const of = (m: string) => events.filter(e => e.m === m)
  check('stream: newline JSON, the day first', (sres.headers.get('content-type') ?? '').includes('ndjson') && events[0].t === 'day' && events[0].profile === true && typeof events[0].date === 'string')
  check('stream: each method shows its basis, streams its words, then ends ready', ['western', 'bazi'].every(m => {
    const e = of(m), w = e.findIndex(x => x.t === 'writing'), end = e.findIndex(x => x.t === 'm')
    const words = e.filter(x => x.t === 'd')
    return w >= 0 && !!e[w].basis?.[m] && words.length === 2 && words.map(x => x.d).join('') === reply && end > e.lastIndexOf(words[1]) && e[end].data.status === 'ready' && e[end].data.reading?.summary === 's'
  }), JSON.stringify(events).slice(0, 300))
  check('stream: written once each, and the function is held open for it', houseCalls.length === 2 && afters.length >= 1)
  const partial = require('../lib/partial-json')
  const pf = (x: string) => JSON.stringify(partial.partialFields(x))
  check('draft reader: whole, cut mid-string, mid-key, mid-list, escapes, a fence before it',
    pf(reply) === JSON.stringify({ summary: 's', themes: ['a'], reflect: 'r', why: 'w' })
    && pf('{"summary": "今天可以慢') === JSON.stringify({ summary: '今天可以慢' })
    && pf('{"summary":"a","them') === JSON.stringify({ summary: 'a' })
    && pf('{"summary":"a","themes":["x","y') === JSON.stringify({ summary: 'a', themes: ['x', 'y'] })
    && pf('{"note":"line\\n\\"q\\" \\u6c34') === JSON.stringify({ note: 'line\n"q" 水' })
    && pf('{"note":"half \\u6c') === JSON.stringify({ note: 'half ' })
    && pf('```json\n{"note":"x"}') === JSON.stringify({ note: 'x' }) && pf('no json yet') === '{}', pf('{"note":"line\\n\\"q\\" \\u6c34'))
  const again: any[] = (await (await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant', stream: true }, '10.0.0.2'))).text()).trim().split('\n').map((l: string) => JSON.parse(l))
  check('stream: reopened, the saved reading at once, nothing rewritten', houseCalls.length === 2 && !again.some(e => e.t === 'writing' || e.t === 'd') && again.filter(e => e.t === 'm').every(e => e.data.status === 'ready'))
  check('the daily route never loads the wallet', !fs.readFileSync(path.join(__dirname, '..', 'app/api/xtell/daily/route.ts'), 'utf8').includes('credits'))
  check('every service-role call names the session user', db.calls.filter(c => c.name !== 'select').every(c => c.a.p_user === 'user-a') && db.calls.filter(c => c.name === 'select' && c.table === 'xtell_profiles').every(c => c.filters.some((f: any) => f[0] === 'user_id' && f[1] === 'user-a')))

  // Follow-up: opened from a ready reading, by id, for this user only.
  await profileRoute.PUT(req('http://t/api/xtell/profile', 'PUT', { birth, place: 'taipei', displayTz: 'Asia/Taipei' }))
  const d5 = await json(await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'zh-Hant' })))
  const dailyId = d5.d.methods.western.id
  const f1 = await json(await followRoute.POST(req('http://t/api/xtell/daily/followup', 'POST', { dailyId })))
  check('a follow-up visit is opened for a ready reading', f1.status === 200 && typeof f1.d.readingId === 'string')
  check('bad or unknown ids open nothing', (await followRoute.POST(req('http://t/x', 'POST', { dailyId: 'nope' }))).status === 400 && (await followRoute.POST(req('http://t/x', 'POST', { dailyId: randomUUID() }))).status === 404)

  // The paid follow-up reads the stored basis, never the client's.
  const systems: string[] = []
  const reading = loadRoute('app/api/xtell/reading/route.ts', {
    ...common,
    '@/lib/models': { getModelById: async () => ({ id: 'm1', provider: 'openai', model_name: 'test', display_name: 'Test', enabled: true, blocked_features: [], output_config: { text: { capabilities: [], thinking_levels: [] } } }) },
    '@/lib/providers': { streamText: async (_m: unknown, _msgs: unknown, cb: any, _a: unknown, _c: unknown, opts: any) => { systems.push(opts.system); await cb.onDone({ cost: 0 }) } },
    '@/lib/credits': { debitCredits: async () => {}, accrueFraction: async () => null, InsufficientCreditsError: class extends Error {} },
    '@/lib/provider-errors': { sanitizeProviderError: (m: string) => m },
    '@/lib/xtell': xtell, '@/lib/classics': { classicsBlock: () => '' }, '@/lib/yijing': require('../lib/yijing'), '@/lib/xtell-daily': daily, '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/kyusei': require('../lib/kyusei'), '@/lib/sukuyo': require('../lib/sukuyo'), '@/lib/sunzi': require('../lib/sunzi'), '@/lib/sunzi-scan': { scanSituation: async () => null }, '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/xtell-personality': require('../lib/xtell-personality'), '@/lib/jiemeng': require('../lib/jiemeng'),
  })
  const ask = async (body: any) => { const r = await reading.POST(req('http://t/api/xtell/reading', 'POST', { modelId: 'm1', ...body })); return { status: r.status, text: await r.text() } }
  const r1 = await ask({ temple: 'daily', readingId: f1.d.readingId, question: '今天適合談加薪嗎？', basis: { western: { contacts: [{ transit: 'Pluto', natal: 'Sun' }] } }, chart: 'fake' })
  const sys = systems.at(-1) ?? ''
  check('every teacher gets the length rule: 1000 字, the conclusion first, no repeated summary', sys.includes('全文 1000 字以內') && sys.includes('先給結論') && sys.includes('不要把整段解讀再摘要'))
  const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'app/api/xtell/reading/route.ts'), 'utf8')
  check('the route\'s own Qwen default is thinking off too', /houseDefault = \(model as any\)\.provider !== 'alibaba' \? null : 'thinking_false'/.test(routeSrc))
  check('follow-up: the teacher gets that day\'s stored basis and free reading, nothing the client sent', r1.status === 200 && sys.includes('占星塔的老師') && sys.includes('行運月亮在') && sys.includes('當天的免費解讀') && !sys.includes('fake'))
  check('follow-up needs a question and its visit', (await ask({ temple: 'daily', readingId: f1.d.readingId, question: '' })).status === 400 && (await ask({ temple: 'daily', question: 'x' })).status === 400)
  // A question put to some of the table remembers whom it was for (owner,
  // Sep 27): model ids only, the stored question carries them.
  const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b'
  rpcCalls.length = 0
  await ask({ temple: 'daily', readingId: f1.d.readingId, qid: 'q-to', question: '只問一位', to: [A, 'not-an-id', A], seats: [A, B, '<script>'] })
  const stored = rpcCalls.find(c => c.name === 'xtell_append_turns')?.a?.p_user_turn
  check('the stored question keeps to and seats, model ids only, once each', !!stored && JSON.stringify(stored.to) === JSON.stringify([A]) && JSON.stringify(stored.seats) === JSON.stringify([A, B]))
  rpcCalls.length = 0
  await ask({ temple: 'daily', readingId: f1.d.readingId, qid: 'q-all', question: '問全部' })
  const plain = rpcCalls.find(c => c.name === 'xtell_append_turns')?.a?.p_user_turn
  check('a question without them is stored as before', !!plain && !('to' in plain) && !('seats' in plain))
  db.dailyRows.length = 0
  check('a day no longer kept: 410, nothing sent', (await ask({ temple: 'daily', readingId: f1.d.readingId, question: 'x' })).status === 410)

  // Delete: the profile and every daily thing; a stale daily request finds nothing.
  await json(await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'en' })))
  check('delete removes the profile, daily readings and follow-ups', (await profileRoute.DELETE()).status === 200 && !db.profiles.has('user-a') && db.dailyRows.length === 0 && db.readings.every(r => r.temple !== 'daily'))
  check('after the delete, today is "no profile"', (await json(await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', { lang: 'en' })))).d.profile === null)

  db.setMissing(true)
  check('before migration 109: 503 daily_unavailable everywhere', (await profileRoute.GET()).status === 503 && (await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', {}, '10.9.0.1'))).status === 503 && (await followRoute.POST(req('http://t/x', 'POST', { dailyId: randomUUID() }))).status === 503)
  db.setMissing(false)
  const statuses: number[] = []
  for (let i = 0; i < 13; i++) statuses.push((await dailyRoute.POST(req('http://t/api/xtell/daily', 'POST', {}, '10.7.7.7'))).status)
  check('the 13th daily request in a minute from one address → 429', statuses.slice(0, 12).every(s => s === 200) && statuses[12] === 429)
}

writerStreams().then(routes).catch(e => { fails++; console.log("FAIL threw", e?.stack ?? e) }).then(() => {
  console.log(fails ? `\n${fails} FAILED` : '\nall daily checks passed')
  if (fails) process.exit(1)
})
