// scripts/guandi3d-art.ts — the pictures behind X先知's 3D 關帝廟 prototype
// (owner, Oct 22: "build a 3D temple for 關帝廟 … user can walk around or see
// 關聖帝君 talking … like a 3D game"; "you can spend up to $30 for this").
// House-paid, logged in provider_calls with no user. Every temple is a
// generic one: no real temple's name, plaque or photo (owner's rule).
//
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> hall [gpt|nano] [n]
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> empty <hall.png> [gpt|nano]
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> statue <hall.png> [gpt|nano]
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> props [gpt|nano]
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> closeup <statue.png>
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> hill [n]
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> plaza|giant|hallb|basehall [n]
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> giant-side <front.png> left|right|back
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> hallb-side <front.png>
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> bronze
//   npx tsx --env-file=.env.local scripts/guandi3d-art.ts <outDir> burner|pavilion|banyan|pine|grass|paving|sky|hilltop|hatview [n]
//
// GPT Image 2 high is ~$0.21 a picture, Nano Banana Pro 2K $0.134.

import fs from 'node:fs'
import path from 'node:path'
import { generateImage } from '../lib/providers'
import { getModelByProviderName } from '../lib/models'

const [out, mode, ...rest] = process.argv.slice(2)

const NO_TEXT = 'No people. No readable text anywhere: plaques, couplets and banners carry only blurred, illegible gold calligraphy or are plain. Not any real temple.'
const STATUE = 'a seated statue of 關聖帝君 (Guan Yu) in the traditional Taiwanese temple style: a deep red face, narrow phoenix eyes, thick dark brows, a very long flowing black beard to his chest, a gold-and-jade general\'s crown with red pompoms, a green embroidered robe over gold armour, seated upright on a carved throne, hands resting on his knees, calm and dignified'
const HALL = `Photorealistic interior of the main hall of a traditional Taiwanese 關帝廟, a generic temple. Eye-level view from the middle of the hall, a few steps in from the doorway, looking straight at the main altar, wide 20mm lens. Centre back: an ornate carved and gilded wooden shrine niche with red silk drapes, holding ${STATUE}. In front of it a long carved red lacquer altar table with a bronze tripod incense burner, fruit and flower offerings, a pair of red candles, a bamboo tube full of fortune sticks and a pair of red crescent moon blocks. Red silk lanterns hang from carved, painted beams; coils of hanging incense; two carved stone dragon pillars frame the altar; side altars and wooden lattice windows on the left and right walls. Polished grey stone floor with red kneeling cushions before the altar and a wide open space between the viewer and the altar. Warm morning light through the lattice windows, soft incense haze, rich detail, sharp focus, natural photograph. ${NO_TEXT}`
const EMPTY = `Edit this photograph: remove the seated statue from the shrine niche completely, leaving the niche empty — just its carved gilded throne seat with a folded red silk cushion, the red drapes and the shadowed back wall of the niche, lit exactly as before. Keep everything else in the picture exactly the same: the altar table and every offering on it, the lanterns, pillars, beams, walls, floor, light and camera. ${NO_TEXT}`
const STATUE_REF = `A product photograph of ONE carved and painted wooden temple statue, the same statue as in the attached photograph: ${STATUE}. The whole statue and its throne seen straight from the front, centred, filling most of the frame from the crown to the base of the throne, isolated on a plain light grey studio background, soft even studio lighting with no harsh shadows, sharp focus on every detail of the carving, the paint and the gilding. Only the statue: no altar, no offerings, no drapes, no text.`
// The outdoor idea (owner, Oct 22: "outdoor temple and it's huge", then "a
// generic outdoor hilltop 關帝廟 with a huge seated 關公 on the roof"): a
// temple type, not any real one; the statue sits with hands on his knees like
// the hall's, never another temple's pose.
const HILL = `Photorealistic daytime photograph of a generic traditional Taiwanese 關帝廟 on a green hilltop, seen from the middle of its wide stone front plaza, eye level, wide 18mm lens, looking straight at the temple. The temple: a two-storey red-and-gold hall with sweeping swallowtail roof ridges, dragon and phoenix ridge ornaments, red columns, a broad stone staircase rising to its front doors, two stone guardian lions at the foot of the stairs. Seated on top of the temple's roof, as big as the hall itself, a giant outdoor statue of 關聖帝君 (${STATUE.replace('a seated statue of ', '')}), painted in bright temple colours, looking out over the plaza, his whole figure and crown in frame against a blue sky with soft white clouds. In the plaza: a large bronze incense burner on a stone base in front of the stairs with a little smoke, a long red offering table, red lanterns on strings, the paving wide and open. Around the plaza: low stone balustrades and trees, green hills beyond. Bright natural light, sharp focus, rich detail. ${NO_TEXT}`
// The hilltop, rebuilt in parts (owner, Oct 22: "split them into 神像 and
// 廟宇。場地。then combine them together"; "new statue please ... I want big
// one ... borrow idea from 三國無雙"): the plaza is a Marble world with an
// empty terrace, the hall and the giant statue are Tripo models made from
// several views of one design. The statue borrows the epic-game feel only:
// an original design, no game's character.
const PLAZA = `Photorealistic daytime photograph from the middle of a wide granite plaza on a green hilltop in Taiwan, eye level, wide 20mm lens, looking straight ahead. At the far end of the plaza a broad stone staircase of about ten steps rises to a large, completely EMPTY raised stone terrace edged with low carved stone balustrades; nothing at all stands on the terrace, it is open to the sky. In the plaza: a large bronze incense burner on a round stone base in the centre with a thin line of smoke, a long red offering table beside it, two stone guardian lions at the foot of the staircase, strings of red lanterns overhead. Around the plaza: carved stone balustrades, tall trees, green hills and a blue sky with soft white clouds. Bright natural light, sharp focus, rich detail. No buildings, no statues, no people. ${NO_TEXT}`
const GIANT = `A product photograph of ONE giant outdoor statue of 關聖帝君 (Guan Yu), full body from the top of his headdress to the bottom of his pedestal, centred, isolated on a plain light grey studio background, seen straight from the front at eye level with the statue's chest. An original design with the heroic, powerful presence of a legendary general in an epic action game: a tall, broad-shouldered standing figure in ornate gold and green dragon-scale armour with large lion-head pauldrons and a tiger-head belt buckle, a long green war robe and a flowing cape lined in red, a green general's headscarf with a gold crest; a deep red face with fierce narrow phoenix eyes and thick brows, a very long flowing black beard to his waist. His right hand grips the long Green Dragon Crescent Blade planted upright beside him, its blade curved, with a carved dragon where blade meets shaft; his left hand holds his beard. He stands firmly on a carved stone pedestal of clouds and waves. Painted temple-statue finish: bright colours and gold leaf on sculpted fiberglass, crisp sculpted detail, no gloss. Soft even studio lighting, no harsh shadows, sharp focus. Only the statue: no text, no other objects.`
const GIANT_VIEW: Record<string, string> = {
  left:  'its LEFT side: the statue turned 90 degrees so its left shoulder faces the camera',
  right: 'its RIGHT side: the statue turned 90 degrees so its right shoulder faces the camera',
  back:  'directly BEHIND: the statue turned 180 degrees so its back and cape face the camera',
}
const GIANT_SIDE = (view: string) => `The exact same statue as in the attached photograph, unchanged in every detail of design, colour, armour, cape, headscarf, beard, blade and pedestal, seen from ${GIANT_VIEW[view]}. Full body from the top of the headdress to the bottom of the pedestal, centred at the same size, the same plain light grey studio background and the same soft even lighting. Only the statue: no text, no other objects.`
const HALLB = `An architectural model photograph of ONE traditional Taiwanese temple hall building, isolated on a plain light grey studio background, seen straight from the front and slightly above, the whole building in frame with a little margin: a two-storey red-and-gold hall on a low stone base, sweeping swallowtail roof ridges in orange glazed tile with dragon and phoenix ridge ornaments in colourful cut-tile mosaic, red columns, carved gilded beams and brackets, latticed red doors and windows, a short flight of stone steps at the front. Symmetrical, sharp detail, soft even studio light. No people, no plaques or text, nothing on the roof but its own ornaments.`
// The hall as the statue's base (owner, Oct 22: "the temple it self should
// not be this big ... a one floor structure at the bottom of the state"), with
// a door to walk in through, as at Kamakura's Daibutsu.
const BASEHALL = `An architectural model photograph of ONE single-storey traditional Taiwanese temple hall built as the base of a giant statue, isolated on a plain light grey studio background, three-quarter front view from slightly above, the whole building in frame with a little margin: a broad, nearly square one-storey hall of red columns, carved gilded beams and brackets and latticed red doors, a wide open central doorway at the top of a short flight of stone steps, a low glazed orange-tile eave with small dragon ornaments running all around the top of the walls; above the eave its roof is a FLAT stone terrace edged with carved white stone balustrades, completely empty, nothing standing on it. Sharp detail, soft even studio light. No people, no plaques or text.`
// Inside the giant (owner, Oct 22: "walk inside and go top of the state ...
// similar to 自由女神"): the wall of the stair shaft, tiled.
const BRONZE = `A seamless, tileable flat texture, seen straight on with no perspective and no lighting gradient: the inner skin of a giant hollow bronze statue, overlapping hammered bronze plates in warm brown and dull gold, rows of round rivets along the plate seams, a faint green patina in the seams, evenly lit. Fills the whole square, nothing else, no text.`
// The hilltop, step 3 (owner, Oct 22: "add a 香爐 in front of it ... one floor
// temple to cover the 香爐 ... state is right behind the temple ... add the
// hill and greens, trees"; "budget is not an issue, make the quality better").
const ISO = 'isolated on a plain light grey studio background, soft even studio lighting, sharp focus, no text, nothing else in the picture'
const KIT: Record<string, { prompt: string; size: string }> = {
  burner: { size: '1024x1024', prompt: `A product photograph of ONE large traditional Taiwanese temple incense burner (天公爐) in cast bronze: a round three-legged cauldron with two upright loop handles and relief dragons, topped by a two-tiered pagoda-shaped lid with a pearl finial, standing on a carved granite plinth; a few red incense sticks standing in it. Three-quarter view from slightly above, the whole burner and plinth in frame, ${ISO}.` },
  pavilion: { size: '1536x1024', prompt: `An architectural model photograph of ONE open-sided traditional Taiwanese temple pavilion (拜亭), a single storey with NO walls: six round red lacquered columns with carved gilded brackets holding up a sweeping swallowtail roof of orange glazed tiles, its ridge ends curling up, colourful cut-tile dragons on the ridge and a pearl in the middle, a painted coffered ceiling under the eaves, on a low granite platform with a short flight of steps at the front and at the back. Open on every side so one sees straight through it. Three-quarter front view from slightly above, the whole pavilion in frame, ${ISO}.` },
  banyan: { size: '1024x1024', prompt: `A product photograph of ONE mature banyan tree (榕樹) as a single model: a thick gnarled trunk with a few hanging aerial roots, a broad dense rounded canopy of small dark green leaves, a small patch of earth at its base. The whole tree in frame, seen from the side at eye level, ${ISO}.` },
  pine: { size: '1024x1024', prompt: `A product photograph of ONE tall Taiwan red pine tree as a single model: a straight reddish-brown trunk, layered horizontal clusters of dark green needles in tiers up to a pointed crown, a small patch of earth at its base. The whole tree in frame, seen from the side at eye level, ${ISO}.` },
  grass: { size: '1024x1024', prompt: 'A seamless, tileable texture seen straight down with no perspective and even light: short lush green grass with a few clover leaves and tiny variations in colour, filling the whole square, no objects, no text.' },
  paving: { size: '1024x1024', prompt: 'A seamless, tileable texture seen straight down with no perspective and even light: large square light grey granite paving slabs, each about the same size, four slabs across, fine speckle and slight weathering, thin darker grout lines, filling the whole square, no objects, no text.' },
  // The surroundings as a World Labs world (owner, Oct 22: "why you use
  // cheap 3D models for mountain and trees???"): a hilltop plaza with nothing
  // on it, the statue and pavilion are placed on it as models.
  hilltop: { size: '1536x1024', prompt: 'Photorealistic landscape photograph, eye level, wide 20mm lens, from the near end of a very large, completely EMPTY granite-paved plaza on the top of a green mountain in Taiwan, looking straight along the plaza. Nothing at all stands on the plaza: no buildings, no statues, no burner, no lions, no people, no objects, just clean light grey granite slabs. Along both long sides of the plaza: big old camphor and banyan trees and tall Taiwan red pines with lush, detailed foliage, and low clipped hedges. Beyond the far end of the plaza the hilltop drops away to a deep green valley and layer after layer of forested mountains fading into soft blue mist. A bright blue sky with soft white clouds, warm afternoon sunlight. Rich natural detail, sharp focus. No text, no signs.' },
  // The 360° view from the deck on his hat (owner, Oct 23: "on top of his
  // hat, and 360 view"): open air, nothing near the camera.
  hatview: { size: '1536x1024', prompt: 'Photorealistic photograph taken in the open air from the very top of a giant 36-metre statue on a mountaintop in Taiwan, looking out toward the horizon and a little down. Far below: the small orange-tiled roof of an open pavilion and a long, empty, light grey granite plaza between low hedges, lined on both sides by big old camphor and banyan trees and tall Taiwan red pines seen from above. All around the hilltop, deep green valleys and layer after layer of forested mountain ridges fading into soft blue mist to the horizon. Bright blue sky with soft white clouds, warm afternoon sun from the left. Nothing near the camera: no railing, no window, no wall, no platform, no people. Wide 20mm lens, sharp focus, rich natural detail. No text, no signs.' },
  sky: { size: '1536x1024', prompt: 'A wide panoramic photograph of a bright sky only, seamlessly tileable from the left edge to the right edge: deep blue at the top fading to a pale hazy blue at the bottom, soft scattered white cumulus clouds in the lower half, no ground, no horizon line, no sun disc, no birds, no text.' },
}
const HALLB_SIDE = `The exact same temple hall building as in the attached photograph, unchanged in every detail, seen from its LEFT side (turned 90 degrees), the whole building in frame at the same size, the same plain light grey studio background and soft even light. No people, no plaques or text.`
const CLOSEUP = `A vertical photograph inside a dim traditional Taiwanese temple: a close-up of the carved and painted wooden statue in the attached photograph, the very same statue (${STATUE}), framed from the top of his crown to mid-chest, his face in the upper third of the frame, looking straight at the viewer. He sits in a gilded, carved shrine niche with red silk drapes on both sides; warm candlelight from below and the side, a soft haze of incense smoke, the dark carved interior of the temple behind. Natural photograph, 50mm lens, shallow depth of field, sharp focus on the face and beard. No text, no people.`
const PROPS: Record<string, string> = {
  tube: 'A product photograph of one traditional Taiwanese temple fortune-stick tube: a cylindrical bamboo tube, about 30 cm tall, red lacquer bands near the top and bottom, holding about a hundred thin flat bamboo fortune sticks with red-painted tips sticking up out of it in a loose bundle. Three-quarter view from slightly above, centred, isolated on a plain light grey studio background, soft even studio lighting, sharp focus. No text, no characters on the sticks or the tube.',
  blocks: 'A product photograph of a pair of traditional Taiwanese temple divination moon blocks (筊杯): two identical crescent-shaped wooden blocks, each about 12 cm long, lacquered deep red, one flat side and one rounded side; one block lies flat side up, the other rounded side up, side by side. Three-quarter view from slightly above, centred, isolated on a plain light grey studio background, soft even studio lighting, sharp focus. No text.',
}

async function model(which: string) {
  const m = which === 'nano'
    ? await getModelByProviderName('google', 'gemini-3-pro-image')
    : await getModelByProviderName('openai', 'gpt-image-2')
  if (!m) throw new Error(`${which} not in the catalog`)
  return m
}

async function draw(which: string, prompt: string, file: string, refs: string[] = [], size?: string) {
  const m = await model(which)
  const attachments = refs.map(r => ({ buffer: fs.readFileSync(r), mediaType: r.endsWith('.jpg') || r.endsWith('.jpeg') ? 'image/jpeg' : 'image/png' }))
  const sz = size ?? (which === 'nano' ? '2752x1536' : '1536x1024')
  const r = await generateImage(m, prompt, 'high', sz, attachments as any, null, null, { userId: undefined } as any,
    which === 'nano' ? { aspect_ratio: sz.startsWith('2752') ? '16:9' : sz === '1536x1536' ? '1:1' : null } : undefined)
  fs.writeFileSync(path.join(out, file), r.buffer)
  console.log(`${file}: $${(r.cost ?? 0).toFixed(4)}`)
  return r.cost ?? 0
}

async function main() {
  fs.mkdirSync(out, { recursive: true })
  const costs: Promise<number>[] = []
  if (mode === 'hall') {
    const which = rest[0] ?? 'gpt', n = Number(rest[1] ?? 1)
    for (let i = 0; i < n; i++) costs.push(draw(which, HALL, `hall-${which}-${Date.now()}-${i}.png`))
  } else if (mode === 'empty') {
    costs.push(draw(rest[1] ?? 'gpt', EMPTY, `empty-${path.basename(rest[0], '.png')}-${rest[1] ?? 'gpt'}.png`, [rest[0]], rest[1] === 'nano' ? '2752x1536' : '1536x1024'))
  } else if (mode === 'statue') {
    costs.push(draw(rest[1] ?? 'gpt', STATUE_REF, `statue-${rest[1] ?? 'gpt'}-${Date.now()}.png`, [rest[0]], rest[1] === 'nano' ? '1536x1536' : '1024x1536'))
  } else if (mode === 'hill') {
    const n = Number(rest[0] ?? 1)
    for (let i = 0; i < n; i++) costs.push(draw('gpt', HILL, `hill-gpt-${Date.now()}-${i}.png`))
  } else if (mode === 'plaza' || mode === 'giant' || mode === 'hallb') {
    const n = Number(rest[0] ?? 1)
    const prompt = mode === 'plaza' ? PLAZA : mode === 'giant' ? GIANT : HALLB
    const size = mode === 'giant' ? '1024x1536' : '1536x1024'
    for (let i = 0; i < n; i++) costs.push(draw('gpt', prompt, `${mode}-gpt-${Date.now()}-${i}.png`, [], size))
  } else if (mode === 'basehall') {
    const n = Number(rest[0] ?? 1)
    for (let i = 0; i < n; i++) costs.push(draw('gpt', BASEHALL, `basehall-gpt-${Date.now()}-${i}.png`, [], '1536x1024'))
  } else if (mode === 'bronze') {
    costs.push(draw('gpt', BRONZE, `bronze-gpt-${Date.now()}.png`, [], '1024x1024'))
  } else if (mode in KIT) {
    const n = Number(rest[0] ?? 1)
    for (let i = 0; i < n; i++) costs.push(draw('gpt', KIT[mode].prompt, `${mode}-gpt-${Date.now()}-${i}.png`, [], KIT[mode].size))
  } else if (mode === 'giant-side') {
    costs.push(draw('gpt', GIANT_SIDE(rest[1]), `giant-${rest[1]}-${Date.now()}.png`, [rest[0]], '1024x1536'))
  } else if (mode === 'hallb-side') {
    costs.push(draw('gpt', HALLB_SIDE, `hallb-left-${Date.now()}.png`, [rest[0]], '1536x1024'))
  } else if (mode === 'closeup') {
    costs.push(draw('gpt', CLOSEUP, `closeup-gpt-${Date.now()}.png`, [rest[0]], '1024x1536'))
  } else if (mode === 'props') {
    for (const [name, prompt] of Object.entries(PROPS)) costs.push(draw(rest[0] ?? 'gpt', prompt, `prop-${name}-${Date.now()}.png`, [], rest[0] === 'nano' ? '1536x1536' : '1024x1024'))
  } else throw new Error(`unknown mode ${mode}`)
  const total = (await Promise.all(costs)).reduce((a, b) => a + b, 0)
  console.log(`total $${total.toFixed(4)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
