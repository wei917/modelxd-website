// Read-only check for lib/prompt-refine/rules.ts: prints how the classifier
// and detail level read a set of sample prompts. Run: npx tsx scripts/prompt-refine-cases.ts
import { classifyRequest, detailLevel, NO_PEOPLE_RE, RULES_VERSION, type RefineMode } from '../lib/prompt-refine/rules'

const cases: [string, string, RefineMode][] = [
  ['kyoto travel',        '畫張京都旅行圖', 'image'],
  ['product photo',       'product photo of a matte black ceramic coffee mug', 'image'],
  ['landscape no people', '嵐山の竹林の風景、人物なし、朝', 'image'],
  ['text writing',        '幫我寫一封給客戶的道歉信，因為出貨延遲了一週', 'text'],
  ['video action',        'a cat jumps onto a kitchen table and knocks over a glass', 'video'],
  ['game scene',          '遊戲場景概念圖：廢棄的太空站機庫，沒有人，只有一台壞掉的機甲', 'image'],
  ['detailed character',  'Full-body character design of Mira, a 30-year-old cartographer with short silver hair, round brass goggles pushed up on her forehead, a patched olive field coat over a cream linen shirt, brown leather satchel, holding one rolled map in her left hand, standing relaxed, three-quarter view, neutral light grey background, clean line art with flat colours, no text', 'image'],
  ['edit keep background','把主角的外套换成蓝色，背景和姿势保持不变', 'image'],
  ['code in image mode',  'Unity C#でキャラクターのジャンプのスクリプトを書いて', 'image'],
]
console.log('rules', RULES_VERSION)
for (const [name, p, mode] of cases) {
  console.log(name.padEnd(22), '->', classifyRequest(p, mode).padEnd(8), detailLevel(p).padEnd(9), 'noPeople=' + NO_PEOPLE_RE.test(p))
}
