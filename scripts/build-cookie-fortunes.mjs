// scripts/build-cookie-fortunes.mjs — 幸運餅乾's slips (owner, Sep 28: "use the
// general fortune cookie words; there should be a list online").
//
// Source: reggi/fortune-cookie, 254 fortunes its author hand-typed from his
// own childhood collection of real fortune-cookie slips, MIT licensed
// (content/cookie/LICENSE-fortune-cookie.txt, Copyright (c) 2022 Thomas
// Reggi). Pinned to commit 4d86030 of fortune-cookie.json.
//
// Kept: 206. Dropped (DROP, by source index): duplicates, anything with a
// number, jokes and pick-up lines, lines too garbled to translate, and the
// health, windfall and lawsuit predictions the room does not make. Fixed
// (FIX): obvious typos in the typed-up text (exiting → exciting, sprint →
// spirit …); the original is kept beside the fix as `orig`.
// Translations: content/cookie/translations.json (繁中, 日本語, 한국어, written
// for ModelXD); 简中 is converted from 繁中 with OpenCC (tw → cn) here.
//
//   npm i --no-save opencc-js@1 && node scripts/build-cookie-fortunes.mjs
//   (or NODE_PATH pointing at an opencc-js install elsewhere)
//   → content/cookie/fortunes.json

import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const OpenCC = require('opencc-js')
const toHans = OpenCC.Converter({ from: 'tw', to: 'cn' })

const COMMIT = '4d860305c9d72da9155e92eff3536eb33287b2a9'
const URL = `https://raw.githubusercontent.com/reggi/fortune-cookie/${COMMIT}/fortune-cookie.json`
const DROP = new Set([3, 10, 16, 24, 31, 33, 37, 45, 64, 83, 85, 87, 91, 99, 105, 106, 111, 116, 118, 131, 132, 137, 140, 152, 154, 159, 160, 163, 170, 171, 176, 186, 188, 189, 192, 195, 196, 200, 204, 209, 216, 222, 228, 236, 245, 246, 247, 250])
const FIX = {
  2: 'It is not the outside riches but the inside ones that produce happiness.',
  12: 'Your spirit of adventure leads you down an exciting new path.',
  23: 'Kind words can be short and easy to speak, but their echoes are truly endless.',
  25: 'Age can never hope to win you while your heart is young.',
  26: 'Example is better than precept.',
  32: "Today's profits are yesterday's goodwill ripened.",
  34: 'There is in the worst of fortunes the best chance of a happy ending.',
  40: 'Make every day your best. You will improve yourself greatly.',
  51: 'You will always be successful in your professional career.',
  59: 'Do your best to make it happen.',
  63: 'Do unto others as you wish others do unto you.',
  92: 'Everyone needs to be loved, especially those who do not deserve it.',
  153: 'You find beauty in ordinary things. Do not lose this ability.',
  185: 'Some people never have anything except ideas. Go do it.',
  229: 'Character development is the true aim of education.',
  230: 'Trust him, but still keep your eyes open.',
  253: 'May the warm winds of heaven blow softly upon your spirit.',
}

const src = await (await fetch(URL, { headers: { 'User-Agent': 'ModelXD-build/1.0 (https://www.modelxd.com)' } })).json()
if (!Array.isArray(src) || src.length !== 254) throw new Error(`expected 254 fortunes at ${COMMIT}, got ${src?.length}`)
const tr = JSON.parse(fs.readFileSync('content/cookie/translations.json', 'utf8'))
const fortunes = []
src.forEach((orig, i) => {
  if (DROP.has(i)) return
  const t = tr[String(i)]
  if (!t) throw new Error(`no translation for fortune ${i}`)
  const en = FIX[i] ?? orig
  const f = { id: i, en, 'zh-Hant': t['zh-Hant'], 'zh-Hans': toHans(t['zh-Hant']), ja: t.ja, ko: t.ko, ...(FIX[i] ? { orig } : {}) }
  for (const [k, v] of Object.entries(f)) if (k !== 'id' && k !== 'orig' && (!v || /[0-9０-９]/.test(v))) throw new Error(`fortune ${i}: ${k} empty or has a digit`)
  fortunes.push(f)
})
if (Object.keys(tr).length !== fortunes.length) throw new Error('translations for dropped fortunes')
const out = {
  source: {
    name: 'reggi/fortune-cookie', url: 'https://github.com/reggi/fortune-cookie', commit: COMMIT,
    licence: 'MIT', copyright: 'Copyright (c) 2022 Thomas Reggi', licenceFile: 'content/cookie/LICENSE-fortune-cookie.txt',
    note: 'Real fortune-cookie slips typed up by the author from his own collection. Selected and typo-fixed; translations by ModelXD; zh-Hans by OpenCC.',
  },
  fortunes,
}
fs.writeFileSync('content/cookie/fortunes.json', JSON.stringify(out, null, 1) + '\n')
console.log(`content/cookie/fortunes.json: ${fortunes.length} fortunes`)
