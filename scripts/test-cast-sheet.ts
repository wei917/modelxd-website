// scripts/test-cast-sheet.ts — unit test for the three-view cast rule (lib/cast-sheet.ts).
//   npx tsx scripts/test-cast-sheet.ts
import { singleViewCastSheets, isThreeView, isCastAsset } from '../lib/cast-sheet'

// The three cast prompts actually stored in the DB (Aug 13–15) — all single view.
const real = [
  'Character sheet, medium shot, even soft daylight, plain warm-grey studio background: a young Taiwanese woman in her early twenties, soft layered dark brown hair with side-swept bangs, warm neutral makeup, wearing an oversized cream knit cardigan over a white ribbed camisole; no text, no logos, no watermarks.',
  'Medium shot character sheet of a young Taiwanese woman, long straight dark hair with soft bangs parted center, wearing a dark teal short-sleeve collared school uniform shirt. Even soft daylight, plain neutral corridor background kept simple, standing relaxed, calm confident half-smile, hands visible, eyes to camera. Clean editorial reference photo, no text overlay, no logos.',
  'Medium shot character sheet of a young Taiwanese man, early twenties, short neat dark hair, warm friendly features, wearing a simple white crewneck t-shirt under an open light grey button shirt. Even soft daylight, plain neutral background kept simple, standing relaxed, easy natural half-smile, hands visible, eyes to camera.',
]
const good = [
  'Character sheet, three views of the same person side by side — front, three-quarter, profile — identical outfit, hair and light, plain background: a young woman…',
  'Full-body turnaround on a plain background, 2D cel anime: front view, 3/4 view and profile of the same girl…',
  'Model sheet: front, three-quarter and side view of the same monkey warrior in golden chainmail…',
  '角色設定圖，三視圖：正面、四分之三、側面，同一套服裝與光線，素色背景。',
  'キャラクターシート三面図、同じ衣装、無地背景。',
  '캐릭터 시트 3면도, 같은 의상, 무지 배경.',
]
let fails = 0
const check = (name: string, cond: boolean) => { if (!cond) { fails++; console.log('FAIL', name) } else console.log('ok  ', name) }

real.forEach((s, i) => check(`real #${i + 1} is single view`, !isThreeView(s)))
good.forEach((s, i) => check(`good #${i + 1} is three view`, isThreeView(s)))

check('CAST title detected', isCastAsset({ asset: true, title: 'CAST · 她' }))
check('cast_ id detected', isCastAsset({ asset: true, id: 'cast_him', title: '他' }))
check('LOOK asset ignored', !isCastAsset({ asset: true, title: 'LOOK · golden alley', id: 'look_alley' }))
check('scene ignored', !isCastAsset({ asset: false, title: 'CAST · 她' }))

const scenes = [
  { id: 'cast_her', asset: true, title: 'CAST · 她', shot: real[0] },
  { id: 'cast_him', asset: true, title: 'CAST · 他', shot: good[0] },
  { id: 'look_a',   asset: true, title: 'LOOK · alley', shot: 'a narrow alley at dusk' },
  { id: 's1', title: 'Opening', shot: real[1] },
]
const flagged = singleViewCastSheets(scenes, new Map())
check('fresh board flags only cast_her', flagged.length === 1 && flagged[0].id === 'cast_her')

// Same text already on the client's board = the user's wording → not second-guessed.
const prior = new Map([['cast_her', { shot: real[0] }]])
check('unchanged user text is skipped', singleViewCastSheets(scenes, prior).length === 0)
// Director rewrote it (still single view) → flagged again.
const prior2 = new Map([['cast_her', { shot: 'older text' }]])
check('director-rewritten single view is flagged', singleViewCastSheets(scenes, prior2).length === 1)

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
