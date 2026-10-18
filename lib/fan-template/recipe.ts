// lib/fan-template/recipe.ts: 風扇變裝 (fan outfit change), the template in
// 同款's tab (owner, Oct 18: "template needs to be more accurate"; "the
// template card should be in 做同款 tab and a new section besides 影片連結
// and popular videos"). Shared by the job, the route and the page.
//
// The method is the run the owner called "very close" (t4, Oct 17), made
// repeatable:
//   1. a four-view sheet of the user from one front photo (@quinqueen's
//      prompt: https://higgsfield.ai/@quinqueen/blogs/chatgpt-higgsfield-reel2);
//      the side views are drawn, never asked for (owner, Oct 18);
//   2. the set is fixed (PLATE): a palace room (owner, Oct 18: "elegant,
//      luxury. like palace"; the gilded sofa was the owner's pick), an AI sample woman on
//      the sofa's edge, the Persian rug she lands on, the remote. A sofa and a
//      carpet the user describes or shows are painted into it first
//      (optional); then the user and outfit 1 are edited in, so the room and
//      the camera are the same in every run. The prompts say "the person",
//      never she (Oct 18);
//   3. the opening: a free roll from the sofa onto the rug (Wan image to
//      video: a pinned landing makes people glide), then the remote picked up
//      with one hand, eyes on the camera (Wan first + last frame);
//   4. outfits 2 to 5 (2 to 5 in all; owner, Oct 18: "the min is 2 outfits")
//      are edits of that frame in the creator's poses, each a still clip with
//      the same picture as its first and last frame;
//   5. our own fan at one steady speed makes the changes (fan.ts): walnut
//      blades and a gold hub (the owner's pick), or the user's material; then
//      the clips' own sound and the music. No words on the video (owner, Oct 18: "we don't add
//      captions. users can use their own app to do that").

import type { MusicTarget } from '@/lib/remake/config'

/** The fixed set, 1152x2048: t4's start frame repainted as a palace room
 *  (gilded Louis XV sofa, Persian silk rug, Carrara marble; owner's pick, Oct
 *  18), the rug made a true rectangle ("why the carpet is not straight?"). */
export const PLATE = { bucket: 'xcreate-user-images', path: 'house/fan-outfit/plate-palace.jpg' }
/** The blades' default material (walnut, the owner's pick) and the hub's gold. */
export const DEFAULT_BLADE = { bucket: 'xcreate-user-images', path: 'house/fan-outfit/blade-walnut.jpg' }
export const HUB_GOLD: [number, number, number] = [1.2, 0.98, 0.6]
/** The card's loop, the demo with music and its poster, in the public landing
 *  bucket: the palace demo (v3, Oct 18; the template's own job on its
 *  defaults, an AI model, five luxury outfits, runway music). */
export const DEMO = { card: 'templates/fan-outfit-v3-card.mp4', video: 'templates/fan-outfit-v3-demo.mp4', poster: 'templates/fan-outfit-v3-poster.jpg' }
export const MIN_OUTFITS = 2
export const MAX_OUTFITS = 5

export type FanMusicStyle = 'runway' | 'anime' | Extract<MusicTarget, 'pop' | 'kpop' | 'edm' | 'lofi' | 'rock'>
export const FAN_MUSIC_STYLES: FanMusicStyle[] = ['runway', 'pop', 'anime', 'kpop', 'edm', 'rock', 'lofi']
export type FanMusic = { choice: 'style' | 'mine' | 'none'; style: FanMusicStyle; track?: string }
export type FanOutfit = { text: string; photo?: string }
/** A part of the scene the user chose: words, a reference photo, or both. */
export type FanScenePart = { text?: string; photo?: string }
export type FanScene = { blade?: FanScenePart; sofa?: FanScenePart; carpet?: FanScenePart; floor?: FanScenePart }
export type FanRequest = {
  /** The user's front photo in their upload folder. */
  front: string
  /** 2 to 5, in order. */
  outfits: FanOutfit[]
  /** Optional: unset parts keep the set's own (the walnut fan with its gold
   *  hub, the palace sofa, the Persian rug). */
  scene?: FanScene
  music: FanMusic
  language: string
}

/** What a run of n outfits costs at list price (cents), what it reserves and
 *  about how long it is. Measured on Oct 18's runs ($3.03 for five): seven
 *  pictures at ~$0.07, Wan at $0.10 a second (roll 4 s, remote 5 s, 4 s per
 *  extra outfit), the music by the second; each scene picture ~$0.07. The
 *  reserve leaves room for a refusal sending a picture or clip elsewhere. */
export function fanQuote(outfits: number, scene?: FanScene): { aboutCents: number; reserveCents: number; seconds: number } {
  const n = Math.min(MAX_OUTFITS, Math.max(MIN_OUTFITS, outfits))
  const extras = (scene?.sofa || scene?.carpet || scene?.floor ? 1 : 0) + (scene?.blade ? 1 : 0)
  const aboutCents = 114 + 48 * (n - 1) + 7 * extras
  return { aboutCents, reserveCents: Math.ceil((aboutCents + 90) / 50) * 50, seconds: Math.round(9.2 + 3.2 * (n - 2)) }
}

/** Step 1, 人物四視圖指令 (@quinqueen) for one front photo, without the height
 *  and weight line (the template does not ask for them). */
export const SHEET = '請以我上傳的正面照片作為唯一人物身分參考，完整保留人物的五官、臉型、膚色、髮型及個人辨識度。\n\n生成一張白色背景的寫實四格人物設定圖：左上為正面臉部近照、左下為側面臉部近照、中間為正面全身照、右邊為側面全身照。\n\n四格均為同一人物，穿著同一套簡約米白色居家服，赤腳自然站立。確保每格的樣貌、身高、體型及身材比例一致，不加入文字、配件或其他人物。'

/** Step 2a (optional): the sofa, the carpet and the floor the user asked
 *  for, painted into the set; picture 1 is the set, their reference photos
 *  follow. The shapes and places stay, so the roll and the landing do too. */
export function setPrompt(scene: FanScene): string {
  let next = 2
  const changes: string[] = []
  const say = (p: FanScenePart | undefined, what: string, like: string) => {
    if (!p) return
    const ref = p.photo ? `${like} in picture ${next++}` : ''
    changes.push(`${what}: ${[p.text, ref && `the material, color and look of the ${ref}`].filter(Boolean).join(', ')}`)
  }
  say(scene.sofa, 'the sofa\'s upholstery and color', 'sofa')
  say(scene.carpet, 'the rug on the floor becomes this carpet or rug', 'carpet or rug')
  say(scene.floor, 'the floor around the rug becomes this floor', 'floor')
  return `Edit picture 1. Keep everything else exactly as it is: the camera position, angle and framing, the room${scene.floor ? '' : ' and the floor'}, the person lying on the sofa (pose, clothes, face), the small silver remote on the rug, the light and the shadows. The sofa keeps its exact outline, size, seat height and position; the rug keeps its size and position, flat on the floor, a perfect rectangle with its edges parallel to the edges of the picture. Change only: ${changes.join('; ')}. No ceiling fan, no fan blades, no text, no watermark.`
}

/** The blades' material (optional): a flat picture of it, painted on our
 *  drawn blades (fan.ts); its height runs along the blade. A reference photo
 *  of a fan is picture 1. */
export function bladePrompt(blade: FanScenePart): string {
  const what = [blade.text, blade.photo && 'the same material, color and finish as the blades of the fan in this picture'].filter(Boolean).join(', ')
  return `A flat, evenly lit, straight-on close-up photograph of the surface of a ceiling fan blade: ${what}. The material fills the whole picture edge to edge, its grain or pattern running from top to bottom. No blade outline, no edges, no background, no shadows, no room reflections, no objects, no text.`
}

const KEEP = '其他全部完全不變：攝影機角度、比例、構圖、光線、沙發、地毯、地板、遙控器。畫面中沒有吊扇、沒有扇葉。無文字、無浮水印。'
const OUTFIT_PHOTO = '服裝的版型、剪裁、布料、顏色、圖案與鞋子完全照最後一張圖片，但不要用那張圖片裡的人。'
/** The set's woman wears white sneakers, and an edit keeps them unless told
 *  (test run, Oct 18: the same sneakers under every outfit). */
const SHOES = '鞋子也要換成搭配這套穿搭的鞋。'

/** Step 2b: the user, in outfit 1, on the set's sofa edge (picture 1 is the
 *  set, picture 2 the sheet, picture 3 the outfit photo if any). */
export function startPrompt(outfit: FanOutfit): string {
  return `編輯第一張圖片。把躺在沙發座墊邊緣的人換成第二張人物設定圖裡的人：臉、五官、膚色、髮型、身材和性別完全照設定圖。人物的姿勢、在沙發上的位置、大小、頭朝畫面上方的方向都不變，仍然仰躺在沙發座墊靠地毯那一側的邊緣，看向鏡頭。人物穿著：${outfit.text}。${outfit.photo ? OUTFIT_PHOTO : SHOES}${KEEP}`
}

/** Step 3a, the roll: a real fall (owner, Oct 18: "make falling on the
 *  ground more natural ... like hitting a floor"; of three tries "B is the
 *  best"): over the sofa's edge, a fast drop at real speed, a jolt on
 *  landing, then onto the back, eyes on the camera. Seen from straight above a
 *  drop shows only as speed and impact, so the words ask for both. */
export function roll(scene?: FanScene) {
  return {
    seconds: 4,
    clip: `Realistic fashion video, 9:16, 4 seconds, one continuous shot starting from this picture. The camera is locked exactly overhead, looking straight down at the floor; it never moves, zooms, pans, tilts or rotates, and the sofa, the rug, the floor and the remote stay exactly where they are in the frame. No ceiling fan in the picture.
0.0–0.8 s: the person, lying on their back at the edge of the sofa seat, rolls onto their side toward the right of the frame until their weight tips over the edge.
0.8–1.2 s: gravity takes over: they drop off the sofa, about 45 cm, at full real-time speed, not slow motion, and land hard on the rug on their shoulder and hip. The impact is visible: the whole body jolts, the hair whips up and falls back, the clothes bounce, the arms and legs flop once.
1.2–4.0 s: they roll the rest of the way onto their back on the rug, head toward the top of the frame and feet toward the bottom, settle and lie still, eyes looking straight up into the camera, arms at their sides.
Real weight and momentum, natural anatomy, real fabric. They never lie face down, never roll more than once, never float, glide or slide.`,
    sound: landingSound(scene),
  }
}
/** The landing as it would sound on this room's floor (owner, Oct 18: "this
 *  is 大理石地板 not 木頭地板"): through a thick rug onto stone by default,
 *  the user's own floor or carpet when they gave one. */
function landingSound(scene?: FanScene): string {
  const on = scene?.floor?.text || scene?.carpet?.text
    ? `on ${scene?.carpet?.text ? `this carpet (${scene.carpet.text})` : 'the rug'} over ${scene?.floor?.text ? `this floor (${scene.floor.text})` : 'a stone floor'}, sounding exactly like a body hitting that floor`
    : 'on a thick rug laid over a marble floor: a deep, short, dense impact, no hollow wooden knock and no echo'
  return `Quiet room tone; at about 1.1 s a heavy, dull, muffled thud as the body lands ${on}; then a soft rustle of fabric. No music, no singing.`
}

/** Step 3b's end frame: the remote in hand, eyes on the camera (t4). */
export const HOLDING = 'Edit this picture. Keep everything exactly as it is: the room, the sofa, the rug, the floor, every object and where it is, the camera position and angle, the framing, the light and shadows, and the clothes, face, hair, pose and position of the person. Change only this: the left hand of the person (the hand on the right side of the frame) now holds the small silver remote, resting on the rug beside their hip, and the remote is no longer lying on the rug; their eyes look straight up into the camera. No text, no letters, no logos.'

/** Step 3b, the remote (owner: "look straight to the camera"; one hand). */
export const REMOTE = {
  seconds: 5,
  clip: 'Locked overhead camera, no movement, no zoom, no rotation. The person keeps their head still and their eyes looking straight up into the camera the whole time; they never look at the remote. At 0.5 s their left hand (on the right side of the frame) closes around the small silver remote lying beside it, without looking at it; at 1.5 s they raise the remote toward the camera and press the button once with their thumb; at 2.5 s they lower that hand back to the rug beside their hip, still holding the remote, and then lie still. Their other hand stays still at their side. No cuts.',
  sound: 'Quiet room tone, a soft click of a remote button. No music, no singing.',
}

/** Outfits 2-5 in the creator's poses (their timeline, 5.5-15.0 s); fewer
 *  outfits take the first ones. */
export const POSES: { pose: string; clip: string }[] = [
  { pose: '人物仰躺在地毯上同一個位置，雙手放在腰部附近、手肘朝外，腳踝輕輕交叉，頭部微微轉向一側。', clip: 'breathing softly, at 1.5 s the head turns a few degrees' },
  { pose: '人物仰躺在地毯上同一個位置，一隻手放在臀部，另一隻手放在地毯上，雙膝略微偏向一側。', clip: 'breathing gently, at 1.2 s one slow blink' },
  { pose: '人物仰躺在地毯上同一個位置，雙臂交叉在胸前，腳踝輕輕交叉，自信地看向上方的鏡頭。', clip: 'breathing softly, at 1 s a faint confident smile' },
  { pose: '人物仰躺在地毯上同一個位置，一隻手放在腹部，另一隻手自然向外伸展，臉稍微轉向沙發，表情放鬆。', clip: 'breathing gently, at 0.5 s a soft small smile' },
]

/** Outfit n (2-5) as an edit: picture 1 the base frame, picture 2 the sheet,
 *  picture 3 the outfit photo if any. */
export function outfitPrompt(n: number, outfit: FanOutfit): string {
  const p = POSES[n - 2]
  return `編輯第一張圖片。房間、沙發、地毯、地板、攝影機位置與角度、構圖、光線和陰影全部完全不變。人物的臉、五官、膚色、髮型、身材和性別完全照第二張人物設定圖。只改兩件事：人物換上這套服裝：${outfit.text}。${outfit.photo ? OUTFIT_PHOTO : SHOES}${p.pose}小型銀色遙控器放在地毯上、人物左手（畫面右側那隻手）旁邊，不在手裡。畫面中沒有吊扇、沒有扇葉。無文字、無浮水印。`
}
export const stillClip = (n: number) => ({
  seconds: 4,
  clip: `Locked overhead camera, no movement. The person lies still in the same pose for the whole shot, ${POSES[n - 2].clip}, no change of position, so the shot ends on the frame it starts with. No cuts.`,
  sound: 'Quiet room tone and a soft steady whir in the room, faint breathing; no music, no singing.',
})

/** The cut's clock (t4's numbers): the roll's first 3 s and the remote clip
 *  from 0.4 s make the opening; the fan starts at the remote's press and a
 *  blade passes every 3.2 s; the last outfit stays 1.8 s. */
export const TIMING = { rollEnd: 3.0, remoteFrom: 0.4, step: 3.2, tail: 1.8, lead: 0.6, overlap: 0.2 }
/** Where the press is when the eyes cannot tell (t4's: 2.2 s into the clip). */
export const PRESS_DEFAULT = 2.2
/** The blades: 360 px wide (owner, Oct 18: "360 px is good"), the tip 1200 px
 *  down the frame (hub 150 px above it; "1200 is good"), a round end. */
export const BLADE = { width: 360, length: 1350, hubY: -150 }

/** The music: an original instrumental for the template's length, hits at
 *  the fan's start and each change. 'anime' is the trend's own sound (the
 *  reference's style as the read heard it, never its song). */
const STYLE_WORDS: Record<FanMusicStyle, string> = {
  runway: 'sleek luxury fashion-runway deep house, warm round bass, crisp hi-hats, elegant piano chords and soft strings, about 122 BPM',
  anime: 'energetic J-rock anime opening style, driving drums, distorted electric guitars, bright synth leads, about 135 BPM',
  pop: 'bright upbeat pop, punchy drums, catchy synth hooks, about 120 BPM',
  kpop: 'glossy K-pop dance track, tight drums, bold synth bass, about 125 BPM',
  edm: 'festival EDM, four-on-the-floor kick, big synth drops, about 128 BPM',
  rock: 'upbeat pop-rock, live drums, crunchy guitars, about 130 BPM',
  lofi: 'warm lo-fi chill beat, soft keys, dusty drums, about 85 BPM',
}
export function fanMusicPrompt(style: FanMusicStyle, seconds: number, accents: number[]): string {
  return [
    `An original ${STYLE_WORDS[style]} instrumental, newly composed: its own melody and arrangement, not a cover and not based on any existing song.`,
    'A fashion outfit-change reel: a short light intro, then energy that lifts at each change.',
    `Strong hits or accents at ${accents.map(x => `${x.toFixed(1)} s`).join(', ')}.`,
    'Instrumental only, no vocals.',
    `Exactly ${Math.round(seconds)} seconds long, ending cleanly on the last beat.`,
  ].join(' ')
}

/** The page's opening outfits, in the page's language: five luxury looks
 *  (owner, Oct 18: "elegant, luxury"), long sleeves and high necks so a
 *  picture of them lying down is not refused; the page starts with all five,
 *  the user keeps 2 to 5. */
export const DEFAULT_OUTFITS: Record<string, string[]> = {
  'zh-Hant': ['象牙白絲綢襯衫配高腰寬褲與金色首飾', '黑色長袖緞面晚禮服', '香檳金亮片長袖禮服', '酒紅色絲絨高領長禮服', '白色粗花呢套裝配珍珠項鍊'],
  'zh-Hans': ['象牙白丝绸衬衫配高腰阔腿裤与金色首饰', '黑色长袖缎面晚礼服', '香槟金亮片长袖礼服', '酒红色丝绒高领长礼服', '白色粗花呢套装配珍珠项链'],
  en: ['Ivory silk blouse with high-waisted wide trousers and gold jewelry', 'Black long-sleeve satin evening gown', 'Champagne-gold sequin long-sleeve gown', 'Burgundy velvet high-neck gown', 'White tweed suit with a pearl necklace'],
  ja: ['アイボリーのシルクブラウスとハイウエストのワイドパンツ、金のアクセサリー', '黒の長袖サテンのイブニングドレス', 'シャンパンゴールドのスパンコールの長袖ドレス', 'ボルドーのベルベットのハイネックドレス', '白のツイードスーツとパールのネックレス'],
  ko: ['아이보리 실크 블라우스와 하이웨이스트 와이드 팬츠, 골드 주얼리', '블랙 롱슬리브 새틴 이브닝 드레스', '샴페인 골드 스팽글 롱슬리브 드레스', '버건디 벨벳 하이넥 드레스', '화이트 트위드 수트와 진주 목걸이'],
}
