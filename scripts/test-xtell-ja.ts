// scripts/test-xtell-ja.ts — the Japanese XTell copy reads as Japanese
// (a Japanese tester, Sep 29: 筊, 廟, 籤詩 and 老師 were Chinese carried
// into Japanese; 八字, 月老 and 九曜 needed familiar names; the footer said
// every reading was of a 命盤). Run: npx tsx scripts/test-xtell-ja.ts
import fs from 'node:fs'
import path from 'node:path'
import { STRINGS } from '../lib/i18n'
import { XTELL_TEMPLE_NAMES } from '../lib/xtell-meta'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const S = STRINGS as any
const ja = Object.entries(S).filter(([k, v]: [string, any]) => (k.startsWith('xtell') || k.startsWith('legal')) && typeof v?.ja === 'string').map(([k, v]: [string, any]) => [k, v.ja as string] as const)
const bad = (rx: RegExp) => ja.filter(([, v]) => rx.test(v)).map(([k]) => k)

check('no 老師 in Japanese: the teachers are 先生', bad(/老師/).length === 0, bad(/老師/).join(' '))
check('no 籤詩, 廟街, 入廟, 解籤, 還願 or 守願人 in Japanese', bad(/籤詩|廟街|入廟|解籤|還願|守願/).length === 0, bad(/籤詩|廟街|入廟|解籤|還願|守願/).join(' '))
// 筊 only as a gloss after ポエ, or as a named result (聖筊 / 笑筊 / 陰筊) the rule has explained.
const bareJiao = ja.filter(([, v]) => v.replace(/ポエ（筊[^）]*）|[聖笑陰]筊/g, '').includes('筊')).map(([k]) => k)
check('筊 never stands alone in Japanese: ポエ（筊）', bareJiao.length === 0, bareJiao.join(' '))
check('命盤 in Japanese only for 紫微斗数', bad(/命盤/).every(k => k.includes('ziwei')), bad(/命盤/).join(' '))
check('familiar Japanese names', S['xtell.site.focus.bazi.name'].ja === '四柱推命（八字）' && S['xtell.site.focus.yuelao.name'].ja === '縁結び（月老）' && S['xtell.site.focus.navagraha.name'].ja.startsWith('インド占星術'))
check('九曜 says it is not 九星気学', S['xtell.site.focus.navagraha.description'].ja.includes('九星気学とは別'))
check('媽祖, 関帝, 四面仏 and 月老 say who they are, in ja, ko and en', ['mazu', 'guandi', 'simianfo', 'yuelao'].every(t => ['ja', 'ko', 'en'].every(l => {
  const d = S[`xtell.site.focus.${t}.description`][l] as string
  return /海の女神|sea goddess|바다의 여신|関羽|Guan Yu|관우|ブラフマー|Brahma|브라흐마|赤い糸|red thread|붉은 실/.test(d)
})))
check('the footer and disclaimer no longer say every reading is of a chart', ['xtell.site.footerNote', 'xtell.disclaimer'].every(k => ['ja', 'ko', 'en'].every(l => /カード|card|카드/.test(S[k][l]))))
check('the omikuji edition has its own line, in five languages, and it claims no throw', ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].every(l => S['xtell.qian.random.omikuji']?.[l]?.trim() && !/筊|ポエ|throw|교배|성배/.test(S['xtell.qian.random.omikuji'][l])))
const client = fs.readFileSync(path.join(__dirname, '..', 'app/xtell/client.tsx'), 'utf8')
check('the ritual panel uses it when no 筊 is thrown', client.includes("t(jiao ? 'xtell.qian.random' : 'xtell.qian.random.omikuji')"))
check('link previews carry the same names', Object.entries(XTELL_TEMPLE_NAMES).every(([t, n]) => ['ja', 'ko'].every(l => (n as any)[l] === S[`xtell.site.focus.${t}.name`][l])))

console.log(fails ? `\n${fails} FAILED` : '\nall Japanese copy checks passed')
if (fails) process.exit(1)
