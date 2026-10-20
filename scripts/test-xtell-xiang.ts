// scripts/test-xtell-xiang.ts — 相學館 (Oct 6): the 相盤's shape and how a
// model's reply is cleaned, what the masters read, the master's rules, the
// chart route (sign-in, photos, the lenient check, the daily cap, no photos
// kept, never on a refresh) and the reading route (the saved 相盤 and the
// visitor's correction); 看我們兩個, the other person's photos with the
// visitor's word that they agreed. Models are stubbed: no network, no spend.
//   npx tsx scripts/test-xtell-xiang.ts

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import * as xg from '../lib/xiang'
import { palmLines } from '../lib/palm-lines'
import * as sz from '../lib/sunzi'
import * as jm from '../lib/jiemeng'
import * as xtell from '../lib/xtell'
import * as yijing from '../lib/yijing'
import { STRINGS } from '../lib/i18n'
import { liveFeature } from '../lib/xtell-catalog'
import { displayTemples, TEMPLE_ART } from '../app/components/xtell/TempleArtwork'
import { heroTemples } from '../lib/xtell-hero'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const
const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

// ── The 相盤: what a model's reply becomes ───────────────────────────────
{
  const raw = {
    face: { summary: ' 長橢圓  ', features: [{ part: '臉型', text: '偏長' }, { part: '', text: 'x' }, { part: '眼', text: 'a'.repeat(400) }], marks: { hairline: [500, 160], brow: [501.6, 320], chin: [-20, 1200], bogus: [1, 2] }, box: [800, 100, 200, 600] },
    left: { summary: '左掌', features: [{ part: '生命線', text: '長' }], lines: [{ key: 'life', points: [[10, 20], [30, 40]], note: 'n' }, { key: 'life', points: [[1, 1], [2, 2]] }, { key: 'evil', points: [[1, 1], [2, 2]] }, { key: 'head', points: [[1, 1]] }] },
    right: { summary: '右掌', features: [{ part: '生命線', text: '長' }], lines: [] },
  }
  const c = xg.cleanChart(raw, ['face', 'left'], 'claude-opus-5-5', 'ja')!
  check('only the photos sent are read (a right hand nobody sent is dropped)', !!c.face && !!c.left && c.right === null)
  check('points are whole numbers inside the photo; unknown marks dropped; an upside-down box dropped', c.face!.marks.brow?.[0] === 502 && c.face!.marks.chin?.join() === '0,1000' && !('bogus' in c.face!.marks) && c.face!.box === null)
  check('features need a name and words, and are cut to length', c.face!.features.length === 2 && c.face!.features[1].text.length === 240)
  check('palm lines: known lines only, once each, words only (any points the reader sends are dropped)', c.left!.lines.map(l => l.key).join() === 'life,head' && c.left!.lines.every(l => !('points' in l)) && c.left!.lines[0].note === 'n')
  check('the model and the language are kept', c.model === 'claude-opus-5-5' && c.lang === 'ja')
  check('nothing usable is no chart', xg.cleanChart({ face: { features: [] } }, ['face'], 'm', 'en') === null && xg.cleanChart(null, ['face'], 'm', 'en') === null)
  check('a fenced or wrapped reply still parses', xg.parseJson('好的：\n```json\n{"face": null}\n```')?.face === null && xg.parseJson('no json') === null)
  const f = xg.xiangFacts(c, { gender: 'female', dominant: 'left' }, '生命線其實更長')
  check('the masters read: who, the face, the hand, the lines, what was not sent, and the correction last', f.includes('女') && f.includes('慣用手：左手') && f.includes('【面相】') && f.includes('【左手】') && f.includes('沒有提供：右手') && f.endsWith('來訪者對相盤的補充或更正（以此為準）：生命線其實更長'))
  check('the photo check is lenient: only a clear no fails', xg.asCheck({ ok: false, is: 'other', tip: 'x' })?.ok === false && xg.asCheck({ is: 'palm' })?.ok === true && xg.asCheck('x') === null)
  check('the check never says which hand (a wrong guess misleads)', !/左手還是右手」|"hand"/.test(xg.checkPrompt('left', 'zh-Hant')) && /不要判斷是左手還是右手/.test(xg.checkPrompt('left', 'zh-Hant')))
  check('each language names the lines its own way (Japan: 頭脳線)', xg.LINE_NAMES.ja.head === '頭脳線' && xg.LINE_NAMES['zh-Hant'].head === '智慧線' && xg.LINE_NAMES.en.fate === 'fate line')
  const sys = xg.readerSystem('ko')
  check('the reader only describes: no judging looks, age, health or lifespan; writes in the page language', /不評美醜/.test(sys) && /不提任何健康狀況、疾病或壽命/.test(sys) && /한국어/.test(sys) && /0,0/.test(sys))
  check('the reader gives points for the face only, never for the palms', /掌紋不用給座標/.test(sys) && !xg.readerPrompt(['left', 'right'], { gender: 'male', dominant: 'right' }, 'zh-Hant').includes('"points"'))
}

// ── 看我們兩個: two people, one reading ───────────────────────────────────
{
  const prompt = xg.readerPrompt(['face'], { gender: 'male', dominant: 'right' }, 'zh-Hant', { gender: 'female', dominant: 'left', have: ['face', 'left'] })
  check('the reader is told whose photo is whose, the visitor\'s first, and never the relation', /第 1 張：來訪者的臉（正面）；第 2 張：對方的臉（正面）；第 3 張：對方的左手手掌/.test(prompt) && /"partner": \{/.test(prompt) && /對方：女，慣用手是左手/.test(prompt) && !/暗戀|配偶|曖昧/.test(prompt))
  check('a one-person request is as before: no partner, no 來訪者的 labels', !/partner|對方|來訪者的/.test(xg.readerPrompt(['face'], { gender: 'male', dominant: 'right' }, 'zh-Hant')))
  check('the reader describes each person on their own and never compares their looks', /分開描述每一個人/.test(xg.readerSystem('zh-Hant')) && /不比較誰好看/.test(xg.readerSystem('zh-Hant')))
  const raw = {
    face: { summary: '方臉', features: [{ part: '臉型', text: '方' }], marks: {} },
    partner: {
      face: { summary: '圓臉', features: [{ part: '臉型', text: '圓' }], marks: { nose: [500, 600] } },
      left: { summary: '左掌', features: [{ part: '生命線', text: '長' }], lines: [{ key: 'life', note: '弧度大', points: [[1, 2], [3, 4]] }] },
      right: { summary: '沒送的', features: [{ part: 'x', text: 'y' }] },
    },
  }
  const pc = xg.cleanChart(raw, ['face'], 'claude-opus-5-5', 'zh-Hant', ['face', 'left'])!
  check('both people are kept; the other person\'s unsent photo is dropped; palm lines are words only',
    pc.face?.summary === '方臉' && pc.partner?.face?.summary === '圓臉' && pc.partner?.face?.marks.nose?.join() === '500,600' && pc.partner?.left?.lines[0].note === '弧度大' && !('points' in pc.partner!.left!.lines[0]) && pc.partner?.right === null)
  check('a two-person reading with nothing about the other person is no reading', xg.cleanChart({ face: raw.face, partner: {} }, ['face'], 'm', 'zh-Hant', ['face']) === null)
  check('a one-person chart has no partner', !('partner' in xg.cleanChart(raw, ['face'], 'm', 'zh-Hant')!))
  const f = xg.xiangFacts(pc, { gender: 'male', dominant: 'right' }, '她其實是單眼皮', { gender: 'female', dominant: 'left', relation: 'crush' })
  check('the masters read both, the relation, that the other person agreed, and the correction last',
    /【面相】方臉/.test(f) && /對方（與來訪者的關係：暗戀/.test(f) && /照片是來訪者在對方同意下提供的/.test(f) && /【對方的面相】圓臉/.test(f) && /【對方的左手】/.test(f) && /對方沒有提供：右手/.test(f) && f.endsWith('（以此為準）：她其實是單眼皮'))
  check('relations: the five known ones, anything else is 其他', xg.RELATIONS.join() === 'spouse,dating,ambiguous,crush,other' && xg.asRelation('crush') === 'crush' && xg.asRelation('boss') === 'other')
  const room = read('app/components/xtell/Xiang.tsx')
  check('palm lines are not drawn: only the face has marks', !/LINE_COLOR|LINE_NAMES|\.lines\b/.test(room) && /function marksOf\(f: FaceReading/.test(room))
  check('the other person\'s form asks who they are and for the tick that they agreed', /RELATIONS\.map/.test(room) && /type="checkbox" checked=\{consent\}/.test(room) && /t\('xtell\.xiang\.consent'\)/.test(room))
  // The form's look (Oct 8, owner: "beautify the actual page UI").
  const css = read('app/globals.css'), page = read('app/xoracle/client.tsx'), i18n = read('lib/i18n.tsx')
  check('the photo tiles show GPT Image 2\'s guides by each person\'s gender (a Chinese woman or man), not emoji or hand-drawn ones, and a photo fits whole',
    !/'☺'|'✋'|function (FaceArt|PalmArt)/.test(room) && /src=\{guideOf\(k, gender\)\}/.test(room)
    && ['face', 'palm-left', 'palm-right'].every(n => ['female', 'male'].every(g => fs.existsSync(path.join(__dirname, '..', `public/xtell/xiang/guide-${n}-${g}.avif`))))
    && /\.xtell-xiang-thumb img\.is-photo \{ object-fit: contain;/.test(css))
  const xiangCss = css.slice(css.indexOf('/* 相學館 (Oct 6): the form'), css.indexOf('/* The camera on a computer. */'))
  check('the room\'s colours are the site\'s paper, ink and vermilion: no green (owner, Oct 8: "why you use green?")', xiangCss.length > 1000 && !/jade|#1f6b55|#164f3f|#e8f1ec/i.test(xiangCss) && /--xg-accent: var\(--xtell-vermilion/.test(xiangCss))
  check('gender, hand and the relation are native radios in labelled groups',
    (room.match(/<fieldset className="xtell-xiang-seg/g) ?? []).length === 3 && /type="radio" name=\{group\}/.test(room) && /name="xiang-relation"/.test(room))
  check('signed out: the same cards without buttons, and one sign-in', /const locked = \(given \?\? live\) === false/.test(room) && /\{!locked && \(\s*<div className="xtell-xiang-actions">/.test(room) && (room.match(/t\('auth\.signin'\)/g) ?? []).length === 1)
  // Owner, Oct 9: "只放你自己的照片…" was wrong once the other person's tiles were always there.
  const privacyLine = i18n.split('\n').find(l => l.startsWith('  "xtell.xiang.privacy": {')) ?? ''
  check('one privacy line for one or two people: the other person\'s photos if they agreed, on any device (not only a phone)',
    /已同意的對方的照片/.test(privacyLine) && /裝置/.test(privacyLine) && !/手機/.test(privacyLine) && /other person/.test(privacyLine) && !/privacyPair/.test(i18n + room))
  check('相學館 starts with a woman on the left and a man on the right',
    /gender: \(temple === 'guanxiang' \? 'female' : 'male'\)/.test(page) && /: birth\.gender === 'female' \? 'male' : 'female'\)/.test(page))
  check('the privacy line sits in the action footer; the intro is full width under the icon on phones',
    /temple === 'guanxiang' \? <XiangPrivacy \/>/.test(page) && /data-temple=\{temple\}/.test(page) && /\.xtell-room-header\[data-temple="guanxiang"\] > div \{ display: contents; \}/.test(css))
  // Oct 9 (owner: "the slots are way too big"; "side by side 6 slots, no need to put two rows";
  // "remove 看自己 看我們兩個 row"; "you always show two sets. the left one is me and the right one is another person").
  check('two sets of small tiles always, the visitor\'s on the left, each person\'s name, gender and hand in one row above theirs; no mode choice; a reading is for two once the other person has a photo',
    /\.xtell-xiang-people \{ --xg-gap: 16px; display: grid; gap: 10px var\(--xg-gap\); grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); grid-template-areas: "me-head pa-head" "me pa" "terms terms";/.test(css)
    && /@container \(max-width: 79px\) \{\s*\.xtell-xiang-actions \{ display: none; \}/.test(css)
    && !/xiang-mode|setPair|xtell\.xiang\.mode/.test(room + page) && /partner=\{\{/.test(page)
    && /const xiangPair = !!initPartner \|\| Object\.keys\(partnerPhotos\)\.length > 0/.test(page) && /\{pair && <XiangPartnerTerms/.test(room) && (room.match(/<XiangPersonHead who=/g) ?? []).length === 2)
  // Oct 9 (owner: "draw the image to teach users which line means what on palm. and for face, which area is for what").
  const pinKeys = (name: string) => [...(room.match(new RegExp(`const ${name}: Pin\\[\\] = \\[([\\s\\S]*?)\\n\\]`))?.[1] ?? '').matchAll(/key: '(\w+)'/g)].map(m => m[1])
  const worded = (key: string) => { const line = i18n.split('\n').find(l => l.startsWith(`  "${key}": {`)); return !!line && ['"en"', '"zh-Hant"', '"zh-Hans"', '"ja"', '"ko"'].every(l => line.includes(l)) }
  // Oct 12 (owner: "why I am seeing we suggest xtell.q.guanxiang.1 in the prompt box???").
  check('the question box suggests 相學館 questions in every language, and a temple without any gets the general prompt, never a raw key',
    ['1', '2', '3', '4'].every(n => worded(`xtell.q.guanxiang.${n}`)) && /t\(`xtell\.q\.\$\{temple\}\.1`\)\.startsWith\('xtell\.q\.'\) \? t\('xtell\.question\.ph'\)/.test(page))
  check('怎麼看面相、手相 teaches with numbered pictures: nine areas of the face, the five palm lines the reader knows, in every language',
    ['learn-face', 'learn-palm'].every(n => fs.existsSync(path.join(__dirname, '..', `public/xtell/xiang/${n}.avif`)))
    && pinKeys('FACE_PINS').join() === 'upper,middle,lower,yintang,brows,eyes,nose,mouth,ears' && pinKeys('PALM_PINS').join() === xg.LINE_KEYS.join()
    && [...pinKeys('FACE_PINS').map(k => `xtell.xiang.learn.face.${k}`), ...pinKeys('PALM_PINS').map(k => `xtell.xiang.learn.palm.${k}`)].every(worded),
    `${pinKeys('FACE_PINS').join()} / ${pinKeys('PALM_PINS').join()}`)
  // Oct 9 (owner: photos "limit to 1:1 or 9:16, not 16:9"; results "the same size as the placeholder.
  // face + palms"; "process the palm with filters to only show clear lines… and we use those to feed into AI models").
  check('a photo is cut to between square and 9:16; the computer\'s camera takes a square',
    /if \(sw > sh\) \{ sx = \(sw - sh\) \/ 2; sw = sh \}/.test(room) && /else if \(sh > \(sw \* 16\) \/ 9\)/.test(room) && /Math\.min\(v\.videoWidth, v\.videoHeight\)/.test(room)
    && /\.xtell-xiang-camera video \{[^}]*aspect-ratio: 1;[^}]*object-fit: cover;/.test(css))
  check('a palm\'s lines are what the models read and what the 相盤 shows; its tile keeps the photo as taken; the models are told',
    /if \(key === 'face'\) return \{ dataUrl: asTaken, url, w, h \}[\s\S]{0,120}palmLines\(px\.data, w, h\)[\s\S]{0,160}return \{ dataUrl, url, linePhoto:/.test(room)
    && /photo\.linePhoto \? \{ \.\.\.photo, url: photo\.linePhoto \} : photo/.test(room) && /shrinkPhoto\(f, k\)/.test(room)
    && xg.checkPrompt('right', 'zh-Hant').includes(xg.PALM_AS_LINES) && !xg.checkPrompt('face', 'zh-Hant').includes(xg.PALM_AS_LINES) && xg.readerSystem('zh-Hant').includes(xg.PALM_AS_LINES))
  check('the 相盤 shows every photo as the placeholders\' tiles (face with its marks, palms as their lines), a tap opens one large, and the saved image has them all',
    /KEYS\.filter\(k => p\.photos\[k\]\)/.test(room) && /<XiangZoom item=\{zoom\}/.test(room) && /xiangImage\(shown, t, name\)/.test(room)
    && /\.xtell-xiang-results\.is-pair \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/.test(css) && !/xtell-xiang-drawings/.test(room + css))
  {
    // A made-up hand: wall-grey around a skin-coloured block in the middle, one darker crease across it.
    const W = 200, H = 200, px = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, hand = x >= 50 && x < 150 && y >= 30 && y < 190, crease = hand && Math.abs(y - 110) <= 1 && x >= 60 && x < 140
      const [r, g, b] = !hand ? [205, 200, 188] : crease ? [150, 95, 85] : [225, 160, 140]
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255
    }
    const out = palmLines(px, W, H), at = (x: number, y: number) => out[(y * W + x) * 4]
    check('the palm filter: the room goes white, plain skin stays pale, a crease comes out dark',
      at(10, 10) === 255 && at(190, 100) === 255 && at(100, 70) > 200 && at(100, 110) < 120, `room ${at(10, 10)}, skin ${at(100, 70)}, crease ${at(100, 110)}`)
  }
  check('nothing traces or snaps palm lines any more', !fs.existsSync(path.join(__dirname, '..', 'lib/xiang-snap.ts')) && !/TRACERS|tracePalm|snapLines/.test(read('lib/xiang-scan.ts')))
}

// ── The master ─────────────────────────────────────────────────────────────
{
  const m = xtell.MASTERS.guanxiang
  check('the master reads only the 相盤 and the correction, never invents', /只依相盤解讀/.test(m) && /更正以他寫的為準/.test(m))
  check('the master never speaks of illness, health, lifespan or death; never rates looks', /絕不談疾病、健康、壽命或生死/.test(m) && /生命線不代表壽命長短/.test(m) && /不評美醜/.test(m))
  check('the master keeps the hedged tone (no verdicts)', /不說定數/.test(m) && m.includes(xtell.TONE))
  check('only the visitor\'s own photos, or the other person\'s they said agreed', /只看自己的照片，或已同意的對方的照片/.test(m))
  check('two people: likeness and difference as tendencies, never 配不配 or a verdict, never who looks better', /看兩人的合相/.test(m) && /不說兩人「配不配」「會不會在一起」「適不適合結婚」/.test(m) && /不比較誰比較好看/.test(m))
  check('a crush or something unclear: never speaks for the other person\'s heart, respects their wishes', /暗戀或曖昧時，絕不替對方說他的心意/.test(m) && /尊重對方的意願，不鼓勵糾纏/.test(m))
}

// ── Where it sits, what it is called ───────────────────────────────────────
{
  check('相學館 right after the rotation in every market', LANGS.every(l => displayTemples(l).indexOf('guanxiang') === heroTemples(l).length), LANGS.map(l => displayTemples(l).indexOf('guanxiang')).join())
  check('its icon files are on disk', ['portrait', 'icon', 'iconClear'].every(k => fs.existsSync(path.join(__dirname, '..', 'public', (TEMPLE_ART.guanxiang.src as any)[k]))))
  check('its rebuild keeps the chosen size (95% of the width)', /FILL_BY_TEMPLE = \{[^}]*guanxiang: 0\.95/.test(read('scripts/xtell-icon-from-png.mjs')))
  check('its clear icon comes from the approved PNG, not from clearing paper', !/guanxiang/.test(read('scripts/xtell-clear-icons.mjs').split('\n').filter(l => l.startsWith('await clear(')).join('\n')) && /xtell-icon-from-png\.mjs/.test(read('scripts/xtell-clear-icons.mjs')))
  const keys = Object.keys(STRINGS).filter(k => k.startsWith('xtell.xiang.') || k.includes('guanxiang') || ['xtell.err.photo_required', 'xtell.err.photo_unclear', 'xtell.err.photo_invalid', 'xtell.err.xiang_failed', 'xtell.err.xiang_daily', 'xtell.err.xiang_missing', 'xtell.err.partner_photo_required', 'xtell.err.xiang_consent'].includes(k))
  check(`all ${keys.length} strings in five languages`, keys.length > 60 && keys.every(k => LANGS.every(l => typeof (STRINGS as any)[k]?.[l] === 'string' && (STRINGS as any)[k][l].trim())), keys.filter(k => !LANGS.every(l => (STRINGS as any)[k]?.[l])).join())
  check('the Japanese room is 手相・人相; the Chinese one 相學館', (STRINGS as any)['xtell.site.focus.guanxiang.name'].ja === '手相・人相' && (STRINGS as any)['xtell.site.focus.guanxiang.name']['zh-Hant'] === '相學館')
  check('the guide knows it', liveFeature('guanxiang')?.temple === 'guanxiang' && read('content/xtell-guide.md').includes('### guanxiang'))
}

// ── The routes ─────────────────────────────────────────────────────────────
function loadRoute(file: string, modules: Record<string, unknown>) {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports: any = {}
  vm.runInNewContext(js, {
    exports, console: { ...console, warn: () => {} }, process, Response, Request, ReadableStream, TextEncoder, crypto: globalThis.crypto,
    setInterval, clearInterval,
    require: (name: string) => { const deps: Record<string, unknown> = { 'next/server': { after: () => {} }, '@/lib/xtell-thread': require('../lib/xtell-thread'), '@/lib/xtell-memory': require('../lib/xtell-memory'), '@/lib/conversation-memory': require('../lib/conversation-memory'), ...modules }; if (!(name in deps)) throw new Error('unexpected route dependency: ' + name); return deps[name] },
  }, { filename: file })
  return exports
}
const post = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
function fakeDb(rows: any[], user: string | null = 'user-a') {
  const inserted: any[] = [], updated: any[] = []
  const db = {
    auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) },
    rpc: async () => ({ error: null }),
    from(table: string) {
      let op = 'select', values: any = null, single = false
      const filters: any[] = []
      const q: any = {
        select: () => q, is: () => q, order: () => q, limit: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        single: () => { single = true; return q }, maybeSingle: () => { single = true; return q },
        insert: (v: any) => { op = 'insert'; values = v; return q },
        update: (v: any) => { op = 'update'; values = v; return q },
        then: (resolve: any, reject: any) => {
          const mine = rows.filter(r => filters.every(([k, v]) => r[k] === v))
          const out = op === 'insert' ? (inserted.push({ table, ...values }), { data: { id: '00000000-0000-4000-8000-00000000f00d' }, error: null })
            : op === 'update' ? (updated.push({ table, values, filters }), { data: null, error: null })
            : single ? { data: mine[0] ?? null, error: null } : { data: mine, error: null }
          return Promise.resolve(out).then(resolve, reject)
        },
      }
      return q
    },
  }
  return { db, inserted, updated }
}

async function routes() {
  const jpeg = 'data:image/jpeg;base64,' + Buffer.alloc(4000, 7).toString('base64')
  let checks: Record<string, any> = {}, chart: any = null, reads = 0, lastPartner: any = null
  const scan = {
    photosOf: xg.photosOf,
    // The other person's photos are checked under 'p.<slot>' here, to tell them apart.
    checkPhotos: async (photos: any[]) => Object.fromEntries(photos.map(p => [p.key, checks[(p.who === 'partner' ? 'p.' : '') + p.key] ?? { ok: true, is: 'palm', tip: '' }])),
    readPhotos: async (_p: unknown, _w: unknown, _l: unknown, _u: unknown, partner?: any) => { reads++; lastPartner = partner ?? null; return chart },
  }
  const chartRoute = (rows: any[], user: string | null = 'user-a') => {
    const f = fakeDb(rows, user)
    const POST = loadRoute('app/api/xtell/chart/route.ts', {
      '@/lib/supabase-server': { createSupabaseServer: async () => f.db }, '@/lib/xtell': xtell, '@/lib/yijing': yijing, '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/kyusei': require('../lib/kyusei'), '@/lib/sukuyo': require('../lib/sukuyo'), '@/lib/xiang': require('../lib/xiang'), '@/lib/xiang-scan': scan, '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/xtell-personality': require('../lib/xtell-personality'), '@/lib/xtell-cookie-fortunes': require('../lib/xtell-cookie-fortunes'), '@/lib/xtell-almanac': require('../lib/xtell-almanac'), '@/lib/xtell-daily-model': { dailyText: async () => null }, '@/lib/credits': { debitCredits: async () => 0, grantCredits: async () => 0, InsufficientCreditsError: class extends Error {} }, '@/lib/jiemeng': jm, '@/lib/jiemeng-scan': { scanDream: async () => null }, '@/lib/sunzi': sz,
      '@/lib/sunzi-scan': { scanSituation: async () => null },
    }).POST
    return { ...f, cast: async (body: any) => { const r = await POST(post('http://t/api/xtell/chart', { temple: 'guanxiang', gender: 'female', dominant: 'left', lang: 'zh-Hant', ...body })); return { status: r.status, d: await r.json() as any } } }
  }
  chart = xg.cleanChart({ left: { summary: '左掌', features: [{ part: '生命線', text: '長' }], lines: [{ key: 'life', points: [[1, 2], [3, 4]] }] } }, ['left'], 'claude-opus-5-5', 'zh-Hant')

  const guest = chartRoute([], null)
  check('chart: signed out, nothing is read', (await guest.cast({ photos: { left: jpeg } })).status === 401 && reads === 0)
  const a = chartRoute([])
  check('chart: no photo is refused by code', (await a.cast({ photos: {} })).d.code === 'photo_required')
  check('chart: a photo that is not an image is refused whole', (await a.cast({ photos: { left: 'data:text/html;base64,PGI+' } })).d.code === 'photo_invalid')
  check('chart: a refresh never reads again', (await a.cast({ photos: { left: jpeg }, refresh: true })).d.code === 'xiang_refresh' && reads === 0)
  checks = { left: { ok: false, is: 'other', tip: '請換一張手掌照' } }
  const bad = await a.cast({ photos: { left: jpeg } })
  check('chart: a photo the check turns down comes back with its tip, before any reading', bad.status === 422 && bad.d.code === 'photo_unclear' && bad.d.checks.left.tip === '請換一張手掌照' && reads === 0)
  checks = {}
  const ok = await a.cast({ photos: { left: jpeg } })
  const row = a.inserted.at(-1)
  check('chart: read once, saved with the visit', ok.status === 200 && reads === 1 && ok.d.chart.left.lines[0].key === 'life' && ok.d.readingId && row?.temple === 'guanxiang')
  check('chart: the photos are never saved; only gender, hand, which photos and the reading', !JSON.stringify(row).includes('base64') && row.subject.gender === 'female' && row.subject.dominant === 'left' && row.subject.have.join() === 'left' && typeof row.subject.shot === 'string')
  const hour = 3_600_000
  const today = Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, user_id: 'user-a', temple: 'guanxiang', created_at: new Date(Date.now() - i * hour).toISOString() }))
  const capped = chartRoute(today)
  check('chart: ten readings a day, then refused before any model call', (await capped.cast({ photos: { left: jpeg } })).d.code === 'xiang_daily' && reads === 1)
  chart = null
  check('chart: no reader could read: refused, nothing saved', (await chartRoute([]).cast({ photos: { left: jpeg } })).d.code === 'xiang_failed')

  // 看我們兩個: the other person's photos, only with the visitor's word.
  chart = xg.cleanChart({ face: { summary: '方臉', features: [{ part: '臉型', text: '方' }], marks: {} }, partner: { face: { summary: '圓臉', features: [{ part: '臉型', text: '圓' }], marks: {} } } }, ['face'], 'claude-opus-5-5', 'zh-Hant', ['face'])
  const before = reads
  const two = chartRoute([])
  check('pair: no tick that the other person agreed, refused before any model call', (await two.cast({ photos: { face: jpeg }, partner: { relation: 'crush', photos: { face: jpeg } } })).d.code === 'xiang_consent' && reads === before)
  check('pair: none of the other person\'s photos, refused', (await two.cast({ photos: { face: jpeg }, partner: { relation: 'crush', consent: true, photos: {} } })).d.code === 'partner_photo_required' && reads === before)
  check('pair: a broken photo of theirs is refused whole', (await two.cast({ photos: { face: jpeg }, partner: { consent: true, photos: { face: 'data:image/gif;base64,R0lG' } } })).d.code === 'photo_invalid')
  checks = { 'p.face': { ok: false, is: 'other', tip: '請換一張對方的正臉' } }
  const theirs = await two.cast({ photos: { face: jpeg }, partner: { relation: 'crush', consent: true, photos: { face: jpeg } } })
  check('pair: their photo the check turns down comes back under theirs, before any reading', theirs.status === 422 && theirs.d.partnerChecks.face.tip === '請換一張對方的正臉' && theirs.d.checks.face.ok === true && reads === before)
  checks = {}
  const both = await two.cast({ photos: { face: jpeg }, partner: { relation: 'crush', gender: 'male', dominant: 'left', consent: true, photos: { face: jpeg } } })
  const pairRow = two.inserted.at(-1)
  check('pair: read once with both, saved with who they are and that they agreed, never their photos',
    both.status === 200 && reads === before + 1 && lastPartner?.who?.relation === 'crush' && lastPartner?.photos?.length === 1 && lastPartner.photos[0].who === 'partner'
    && JSON.stringify(pairRow.subject.partner) === JSON.stringify({ gender: 'male', dominant: 'left', relation: 'crush', have: ['face'], consent: true }) && !JSON.stringify(pairRow).includes('base64') && both.d.chart.partner.face.summary === '圓臉')
  check('pair: a relation nobody knows is 其他', (await two.cast({ photos: { face: jpeg }, partner: { relation: 'boss', consent: true, photos: { face: jpeg } } })).status === 200 && two.inserted.at(-1).subject.partner.relation === 'other')

  // The reading route: the saved 相盤, never the client's; the correction kept.
  const systems: string[] = []
  const visitId = '00000000-0000-4000-8000-00000000beef'
  const saved = xg.cleanChart({ face: { summary: '長臉', features: [{ part: '印堂', text: '開闊' }], marks: {} } }, ['face'], 'claude-opus-5-5', 'zh-Hant')
  const readingRoute = (rows: any[]) => {
    const f = fakeDb(rows)
    const POST = loadRoute('app/api/xtell/reading/route.ts', {
      '@/lib/supabase-server': { createSupabaseServer: async () => f.db },
      '@/lib/xtell-admin': { xtellAdmin: () => { throw new Error('no service role here') }, dailyMissing: () => false },
      '@/lib/models': { getModelById: async () => ({ id: 'm1', provider: 'openai', model_name: 'test', display_name: 'Test', enabled: true, blocked_features: [], output_config: { text: { capabilities: [], thinking_levels: [] } } }) },
      '@/lib/providers': { streamText: async (_m: unknown, _msgs: unknown, cb: any, _a: unknown, _c: unknown, opts: any) => { systems.push(opts.system); await cb.onDone({ cost: 0 }) } },
      '@/lib/credits': { debitCredits: async () => {}, accrueFraction: async () => null, InsufficientCreditsError: class extends Error {} },
      '@/lib/provider-errors': { sanitizeProviderError: (m: string) => m },
      '@/lib/xtell': xtell, '@/lib/classics': { classicsBlock: () => '' }, '@/lib/yijing': yijing, '@/lib/xtell-daily': require('../lib/xtell-daily'), '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/kyusei': require('../lib/kyusei'), '@/lib/sukuyo': require('../lib/sukuyo'), '@/lib/xiang': require('../lib/xiang'), '@/lib/xiang-scan': scan, '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/xtell-personality': require('../lib/xtell-personality'), '@/lib/jiemeng': jm, '@/lib/sunzi': sz,
    }).POST
    return { ...f, ask: async (body: any) => { const r = await POST(post('http://t/api/xtell/reading', { temple: 'guanxiang', modelId: 'm1', question: '我的印堂怎麼看？', ...body })); await r.text(); return { status: r.status } } }
  }
  const visit = { id: visitId, user_id: 'user-a', temple: 'guanxiang', chart: saved, subject: { gender: 'male', dominant: 'right', have: ['face'] }, extras: null }
  const r0 = await readingRoute([visit]).ask({})
  check('reading: needs its visit', r0.status === 400)
  const rr = readingRoute([visit])
  const r1 = await rr.ask({ readingId: visitId, note: '眉其實很濃', chart: { face: { summary: '偽造' } } })
  const sys = systems.at(-1) ?? ''
  check('reading: the saved 相盤 reaches the master, the client\'s never', r1.status === 200 && sys.includes('印堂：開闊') && !sys.includes('偽造') && sys.includes('相學館'))
  check('reading: the correction reaches the master and is kept on the visit', sys.includes('眉其實很濃') && rr.updated.some(u => u.values?.extras?.note === '眉其實很濃'))
  const r2 = await readingRoute([{ ...visit, user_id: 'user-b' }]).ask({ readingId: visitId })
  check('reading: another visitor\'s visit is not read', r2.status === 400)
  const pairVisit = { ...visit, chart, subject: { gender: 'female', dominant: 'right', have: ['face'], partner: { gender: 'male', dominant: 'left', relation: 'crush', have: ['face'], consent: true } } }
  const r3 = await readingRoute([pairVisit]).ask({ readingId: visitId, note: '' })
  const sys3 = systems.at(-1) ?? ''
  check('reading: a pair visit gives the master both 相盤 and who the other person is', r3.status === 200 && sys3.includes('【面相】方臉') && sys3.includes('【對方的面相】圓臉') && sys3.includes('對方（與來訪者的關係：暗戀') && sys3.includes('有兩個人時'))
}

// Seen palm-on with the fingers up, a hand's thumb is on its own side: the left
// tile's guide must reach further left than right at the thumb's height (owner,
// Oct 8: "you put the left palm image to the right palm slot"). The outline is
// measured, not the ink: a man's hand is shaded on both sides (Oct 9). The
// woman's slender, light hand (Oct 10) has faint outlines and a thumb that
// reaches less far, hence the paler threshold and the smaller margin.
async function guides() {
  const side = async (file: string) => {
    const { data } = await sharp(path.join(__dirname, '..', 'public/xtell/xiang', file)).resize(200, 200).grayscale().raw().toBuffer({ resolveWithObject: true })
    // The hand's own height (it is drawn smaller and higher since Oct 10), then the middle of it,
    // where the thumb stands out.
    const ink = (y: number) => { let l = -1, r = -1; for (let x = 0; x < 200; x++) if (data[y * 200 + x] < 220) { if (l < 0) l = x; r = x } return l < 0 ? null : [l, r] }
    const rows = Array.from({ length: 200 }, (_, y) => ink(y)), inked = rows.flatMap((v, y) => (v ? [y] : []))
    const top = inked[0], bottom = inked[inked.length - 1]
    let left = 100, right = 100
    for (let y = Math.round(top + 0.3 * (bottom - top)); y <= Math.round(top + 0.7 * (bottom - top)); y++) {
      const v = rows[y]; if (v) { left = Math.min(left, v[0]); right = Math.max(right, v[1]) }
    }
    const reachL = 100 - left, reachR = right - 100
    return reachL > reachR * 1.12 ? 'left' : reachR > reachL * 1.12 ? 'right' : 'unclear'
  }
  const sides = await Promise.all(['female', 'male'].flatMap(g => [side(`guide-palm-left-${g}.avif`), side(`guide-palm-right-${g}.avif`)]))
  check('each left palm tile shows a left palm (thumb on the left), each right tile a right one, for both genders', sides.join() === 'left,right,left,right', sides.join())
}

guides().then(routes).then(() => { console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0) }, e => { console.error('FAIL route tests threw', e); process.exit(1) })
