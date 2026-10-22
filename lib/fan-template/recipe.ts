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

/** The fixed set, 1152x2048, EMPTY: the palace room (gilded Louis XV sofa,
 *  Persian silk rug, Carrara marble; owner's pick, Oct 18) framed so she can
 *  end in the middle without a zoom ("make the sofa smaller ... her final
 *  position should be centered"): a three-seat sofa with three equal seats
 *  ("usually 3 seats or at most 4") as a strip on the left, the rug's
 *  medallion at the middle. Both the start and the end picture are made from
 *  this one room, so the sofa cannot change between them (it grew a small
 *  fourth seat when the end picture redrew it). The remote is a classic one,
 *  walnut with a gold rim and gold buttons like the fan, lying right where her
 *  left hand lands (owner, Oct 19: "the remote controller is still at the
 *  wrong position ... should be more classic"; the silver one lay a hand's
 *  length lower): one guided edit, only its two patches blended back. */
export const PLATE = { bucket: 'xcreate-user-images', path: 'house/fan-outfit/plate-palace4.jpg' }
/** Where the person goes in the start and the end picture (fractions of the
 *  picture), the same size in both: lying on the sofa, the left edge cutting
 *  off a little of them ("it's ok to start 3/4 body"), and lying exactly in
 *  the middle of the rug. A red box drawn there guides each edit, with a
 *  circle at its top the size of a real head (owner, Oct 18: "too stretched
 *  tall. not a normal human": a box 4.4 times as tall as wide made her 9
 *  heads tall; words alone left her at 8.3, the circle at 7.6). */
export const START_BOX = { x: -0.06, y: 0.15, w: 0.35, h: 0.66 }
export const END_BOX = { x: 0.325, y: 0.15, w: 0.35, h: 0.66 }
/** The red marks for a box on a picture w x h: the box, and the head's circle
 *  (the box's height over the heads tall, plus a little for the hair). */
export function guideMarks(b: typeof START_BOX, w: number, h: number, heads = 7.3, waist = false): string {
  const d = Math.round(b.h * h / heads)
  const cx = Math.round((b.x + b.w / 2) * w), wy = Math.round(b.y * h + d * 2.7)
  return `<rect x="${Math.round(b.x * w)}" y="${Math.round(b.y * h)}" width="${Math.round(b.w * w)}" height="${Math.round(b.h * h)}" fill="none" stroke="red" stroke-width="8"/>` +
    `<circle cx="${cx}" cy="${Math.round(b.y * h + d / 2 + 6)}" r="${Math.round(d / 2)}" fill="none" stroke="red" stroke-width="6"/>` +
    // The waist's height, 2.7 heads down (a 6.5-head figure), so the torso
    // keeps its length and the legs cannot grow (Oct 21, the 2D look).
    (waist ? `<line x1="${cx - Math.round(b.w * w * 0.32)}" y1="${wy}" x2="${cx + Math.round(b.w * w * 0.32)}" y2="${wy}" stroke="red" stroke-width="6"/>` : '')
}
/** The blades' default material (walnut, the owner's pick) and the hub's gold. */
export const DEFAULT_BLADE = { bucket: 'xcreate-user-images', path: 'house/fan-outfit/blade-walnut.jpg' }
export const HUB_GOLD: [number, number, number] = [1.2, 0.98, 0.6]
/** The card's loop, the demo with music and its poster, in the public landing
 *  bucket: the palace demo (v8, Oct 19; the template's own job on its
 *  defaults: the three-seat room, the ivory lace start, the pinned fall that
 *  rolls over and ends in the middle, a body of real proportions, the walnut
 *  remote at her hand, the red gown last, runway music, an AI model). */
export const DEMO = { card: 'templates/fan-outfit-v8-card.mp4', video: 'templates/fan-outfit-v8-demo.mp4', poster: 'templates/fan-outfit-v8-poster.jpg' }
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
  /** How the whole video is drawn; unset is 'real'. */
  style?: FanStyle
}

/** How the whole video is drawn (owner, Oct 21: "make the entire video
 *  cartoon/animation style ... 2D"). 'real' is the template as it was; each
 *  look has its own room and blade (made once from the real ones, so every
 *  place and size is the same), its words in every picture and clip, and a
 *  fan drawn to match (`cel`: flat colours and an ink outline, no moving
 *  light). */
export type FanStyle = 'real' | 'anime2d'
export const FAN_STYLES: FanStyle[] = ['real', 'anime2d']
export type FanLook = {
  plate: { bucket: string; path: string }
  blade: { bucket: string; path: string }
  /** The sheet's kind of picture. */
  sheet: string
  /** How the person is drawn into the room (proportions, medium). */
  body: string
  /** Every clip starts with it ('' for real: those clips say it themselves). */
  lead: string
  /** The fall's first words and its physics line. */
  film: string
  physics: string
  /** Added to every outfit edit. */
  keep: string
  cel: boolean
  /** Where the person lies, top and height (fractions; the boxes keep their
   *  x and width), and how many heads tall they are drawn (the circle). */
  frame: { y: number; h: number; heads: number; waist?: boolean }
  /** Placed in the sheet's own clothes first, then only the outfit changed:
   *  put straight into a floor-length gown, the 2D placement drew a body 7.6
   *  to 9.7 heads tall whatever the guide; in two steps 7.1 (Oct 21). It also
   *  keeps a costume a maker refuses out of the step that sets the place. */
  twoStep: boolean
}
const TWO_D = 'classic 2D hand-drawn animated feature film style: clean ink line art, flat cel shading, painted backgrounds'
export const LOOKS: Record<FanStyle, FanLook> = {
  real: {
    plate: PLATE,
    blade: DEFAULT_BLADE,
    sheet: '寫實四格人物設定圖',
    body: 'Real proportions of an average adult, as in a real photograph taken from above, not a fashion illustration and not a model with lengthened legs: the head is about one seventh of their whole length, the legs are of normal length, and with the arms lying along the body the hands reach the middle of the thighs.',
    lead: '',
    film: 'Realistic fashion video',
    physics: 'Real weight and momentum, natural anatomy, real fabric.',
    keep: '',
    cel: false,
    frame: { y: START_BOX.y, h: START_BOX.h, heads: 7.3 },
    twoStep: false,
  },
  anime2d: {
    plate: { bucket: 'xcreate-user-images', path: 'house/fan-outfit/plate-palace4-2d.jpg' },
    blade: { bucket: 'xcreate-user-images', path: 'house/fan-outfit/blade-walnut-2d.jpg' },
    sheet: '2D手繪動畫電影風格（乾淨的墨線、平塗上色）的四格角色設定圖，維持同一個2D動畫角色的造型，不要畫成照片',
    body: `Drawn in the ${TWO_D}, exactly as picture 1 and the character in picture 2 are drawn; never photographic. The red circle is exactly the size of their head: the head fills it from the top of the head to the chin; their natural waist is at the short red line across the box; as large against the body as in the full-body view of picture 2 (about six and a half heads tall), never a smaller head, a longer body or longer legs, even under a long gown; with the arms lying along the body the hands reach the middle of the thighs.`,
    lead: `A ${TWO_D}; it stays a 2D cartoon in every frame, never photographic. `,
    film: `A shot from a ${TWO_D}; it stays a 2D cartoon in every frame, never photographic`,
    physics: 'Believable weight and momentum as in fine 2D animation, the character drawn the same in every frame, the clothes moving as drawn cloth.',
    keep: '整張圖維持2D手繪動畫電影風格（乾淨的墨線、平塗上色），不要變成照片。人物維持第二張設定圖的身材比例（約六頭半身），不要拉長身體或腿。',
    cel: true,
    // Her sheet draws her 6.5 heads tall; in the box made for a real adult the
    // placement stretched her to 8.2 (owner, Oct 21: "the girl too long ...
    // is this normal human ratio?"; "yours is 11 heads long", by the face).
    frame: { y: 0.15, h: 0.66, heads: 6.5, waist: true },
    twoStep: true,
  },
}
export const lookOf = (style?: FanStyle): FanLook => LOOKS[style && LOOKS[style] ? style : 'real']

/** What a run of n outfits costs at list price (cents), what it reserves and
 *  about how long it is. Measured on Oct 18's runs ($3.12 for five, with a
 *  holding picture since dropped): seven pictures at ~$0.07, Wan at $0.10 a
 *  second (roll 4 s, remote 5 s, 4 s per extra outfit), the music by the
 *  second; each scene picture ~$0.07. The reserve leaves room for a refusal
 *  sending a picture or clip elsewhere. */
export function fanQuote(outfits: number, scene?: FanScene): { aboutCents: number; reserveCents: number; seconds: number } {
  const n = Math.min(MAX_OUTFITS, Math.max(MIN_OUTFITS, outfits))
  const extras = (scene?.sofa || scene?.carpet || scene?.floor ? 1 : 0) + (scene?.blade ? 1 : 0)
  const aboutCents = 114 + 48 * (n - 1) + 7 * extras
  return { aboutCents, reserveCents: Math.ceil((aboutCents + 90) / 50) * 50, seconds: Math.round(9.2 + 3.2 * (n - 2)) }
}

/** Step 1, 人物四視圖指令 (@quinqueen) for one front photo, without the height
 *  and weight line (the template does not ask for them). */
export const sheetPrompt = (style?: FanStyle) => SHEET.replace('寫實四格人物設定圖', lookOf(style).sheet)
export const SHEET = '請以我上傳的正面照片作為唯一人物身分參考，完整保留人物的五官、臉型、膚色、髮型及個人辨識度。\n\n生成一張白色背景的寫實四格人物設定圖：左上為正面臉部近照、左下為側面臉部近照、中間為正面全身照、右邊為側面全身照。\n\n四格均為同一人物，穿著同一套簡約米白色居家服，赤腳自然站立。確保每格的樣貌、身高、體型及身材比例一致，不加入文字、配件或其他人物。'

/** Step 2a (optional): the sofa, the carpet and the floor the user asked
 *  for, painted into the empty set; picture 1 is the set, their reference
 *  photos follow. The shapes and places stay, so the roll and the landing do
 *  too. */
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
  return `Edit picture 1. Keep everything else exactly as it is: the camera position, angle and framing, the room${scene.floor ? '' : ' and the floor'}, the walnut remote on the rug, the light and the shadows; the room stays empty of people. The sofa keeps its exact outline, size, seat height and position and its three equal seat cushions; the rug keeps its size and position, flat on the floor, a perfect rectangle with its edges parallel to the edges of the picture. Change only: ${changes.join('; ')}. No ceiling fan, no fan blades, no text, no watermark.`
}

/** The blades' material (optional): a flat picture of it, painted on our
 *  drawn blades (fan.ts); its height runs along the blade. A reference photo
 *  of a fan is picture 1. */
export function bladePrompt(blade: FanScenePart): string {
  const what = [blade.text, blade.photo && 'the same material, color and finish as the blades of the fan in this picture'].filter(Boolean).join(', ')
  return `A flat, evenly lit, straight-on close-up photograph of the surface of a ceiling fan blade: ${what}. The material fills the whole picture edge to edge, its grain or pattern running from top to bottom. No blade outline, no edges, no background, no shadows, no room reflections, no objects, no text.`
}

const OUTFIT_PHOTO = '服裝的版型、剪裁、布料、顏色、圖案與鞋子完全照最後一張圖片；圖中跟服裝一起的帽子或頭飾要戴在頭上；但不要用那張圖片裡的人。'
/** The set's woman wears white sneakers, and an edit keeps them unless told
 *  (test run, Oct 18: the same sneakers under every outfit). */
const SHOES = '鞋子也要換成搭配這套穿搭的鞋。'

/** Steps 2b and 2c: the user in outfit 1, put into the empty set inside the
 *  red box: on the sofa (the start) and in the middle of the rug (the end).
 *  Picture 1 is the set with the box, picture 2 the sheet, picture 3 the
 *  outfit photo if any. */
function placed(outfit: FanOutfit, where: string, style?: FanStyle): string {
  // The user's words too, not only the photo: a hat beside the costume in the
  // photo stayed off her head (Oct 21, 胡桃's hat; the words said 頭戴…帽).
  const wear = outfit.photo
    ? `${outfit.text}; its cut, fabric, color, pattern and shoes exactly as in picture 3, and a hat or headpiece shown with it worn on their head, without the person in that picture`
    : `${outfit.text}, with shoes to match`
  return `Edit picture 1. Put the person from picture 2 (the character sheet: the same face, features, skin, hair, body and gender) ${where} They lie inside the red box: their head, from the top of the head to the chin, fills the red circle at the top of the box, and their feet reach the bottom of the box. ${lookOf(style).body} They wear: ${wear}. Keep everything else exactly as it is: the camera, the framing, the three-seat sofa with its three equal seat cushions and its armrests, the rug and its position, the walnut remote on the rug (it does not move), the floor, the light. Then remove the red marks completely: no red line anywhere. No ceiling fan, no text, no watermark.`
}
export const startPrompt = (outfit: FanOutfit, style?: FanStyle) => placed(outfit, 'lying on their back fully on the sofa seat: lying along the sofa, head toward the top of the picture near the top armrest, feet toward the bottom, arms at their sides, eyes looking up into the camera; as the box does, the left edge of the picture cuts off a little of their body.', style)
export const endPrompt = (outfit: FanOutfit, style?: FanStyle) => placed(outfit, 'lying on their back on the rug: the middle of their body on the vertical center line of the picture, head toward the top of the picture, feet toward the bottom, arms resting along their sides, eyes looking straight up into the camera. Their left hand (the hand on the right side of the picture) rests on the rug right beside the walnut remote, the fingers touching it. The sofa is empty.', style)

/** Step 3a, the roll, from the start picture to the end picture (Wan first
 *  and last frame, so we know where she ends: "her final position should be
 *  centered"): a real fall (owner, Oct 18: "make falling on the
 *  ground more natural ... like hitting a floor"; of three tries "B is the
 *  best"): a light, lazy turn toward the sofa's edge ("I feel she used a lot
 *  of strength to start"), a fast drop at real speed, a jolt on landing,
 *  then onto the back, eyes on the camera. Seen from straight above a
 *  drop shows only as speed and impact, so the words ask for both. One full
 *  roll over, the back to the camera for a moment ("why she didn't roll over
 *  her body?": one take slid off on its side; "never lie face down" had
 *  pushed against it), and the job checks the take (cut.ts rolledOver). */
export function roll(scene?: FanScene, style?: FanStyle) {
  const look = lookOf(style)
  return {
    seconds: 4,
    clip: `${look.film}, 9:16, 4 seconds, one continuous shot starting from this picture. The camera is locked exactly overhead, looking straight down at the floor; it never moves, zooms, pans, tilts or rotates, and the sofa, the rug, the floor and the remote stay exactly where they are in the frame. No ceiling fan in the picture.
0.0–0.8 s: the person, lying on their back at the edge of the sofa seat, lightly and lazily turns onto their side toward the right of the frame: an easy, relaxed little roll with almost no effort, as if drifting off the edge half asleep, limbs loose, no pushing and no bracing, until their weight tips over the edge.
0.8–1.2 s: gravity takes over: they roll OVER as they drop off the sofa, about 45 cm, at full real-time speed, not slow motion: their body keeps turning over their front, so for a moment their back faces the camera, and they land hard on the rug on their shoulder and hip. The impact is visible: the whole body jolts, the hair whips up and falls back, the clothes bounce, the arms and legs flop once.
1.2–4.0 s: they keep rolling the same way onto their back on the rug, one full roll over in all, head toward the top of the frame and feet toward the bottom, settle and lie still, eyes looking straight up into the camera, arms at their sides.
${look.physics} One full roll over, not more; they never slide or shift sideways without turning over, never float or glide.
They end exactly as in the last frame: on their back in the middle of the picture, centered left to right.`,
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

/** Step 3b, the remote (owner: "look straight to the camera"; one hand),
 *  from the landing to the landing (first and last frame the same): she
 *  picks it up, presses and lays it back where it lay, so only her hand can
 *  carry it (owner, Oct 18: "the girl grab it remotely": a last frame with
 *  the remote in her hand had it slide up to meet her, as every edit moved
 *  the remote to the hand rather than the hand to the remote). The outfits
 *  after it have the remote on the rug beside her hand. */
export const remoteShot = (style?: FanStyle) => ({ ...REMOTE, clip: lookOf(style).lead + REMOTE.clip })
export const REMOTE = {
  seconds: 5,
  clip: 'Locked overhead camera, no movement, no zoom, no rotation. The person keeps their head still and their eyes looking straight up into the camera the whole time; they never look at the remote. At 0.5 s their left hand (on the right side of the frame), resting right beside the walnut remote, picks it up without looking at it; at 1.5 s they raise the remote toward the camera and press the button once with their thumb; at 2.5 s they lower that hand, lay the remote back down on the rug exactly where it was, let go of it and rest the hand beside it as at the start; then they lie still. The remote never slides or moves by itself, only in the hand. Their other hand stays still at their side. No cuts.',
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
export function outfitPrompt(n: number, outfit: FanOutfit, style?: FanStyle): string {
  const p = POSES[n - 2]
  return `編輯第一張圖片。房間、沙發、地毯、地板、攝影機位置與角度、構圖、光線和陰影全部完全不變。人物的臉、五官、膚色、髮型、身材和性別完全照第二張人物設定圖。只改兩件事：人物換上這套服裝：${outfit.text}。${outfit.photo ? OUTFIT_PHOTO : SHOES}${p.pose}胡桃木遙控器放在地毯上原本的位置、人物左手（畫面右側那隻手）旁邊，不在手裡。人物的身高、身材比例和在畫面中的位置完全不變，不要拉長。${lookOf(style).keep}畫面中沒有吊扇、沒有扇葉。無文字、無浮水印。`
}
/** The two-step placement's second step: only the outfit changes (picture 1
 *  the placed frame, 2 the sheet, 3 the outfit photo if any). */
export function dressPrompt(outfit: FanOutfit, style?: FanStyle): string {
  return `編輯第一張圖片。房間、沙發、地毯、地板、攝影機位置與角度、構圖、光線和陰影全部完全不變。人物的臉、五官、膚色、髮型、身材和性別完全照第二張人物設定圖。只改一件事：人物換上這套服裝：${outfit.text}。${outfit.photo ? OUTFIT_PHOTO : SHOES}人物的姿勢、頭的大小、身高、身材比例和在畫面中的位置完全不變，不要拉長；長裙蓋住腿，但腳的位置不變。${lookOf(style).keep}胡桃木遙控器放在原本的位置。畫面中沒有吊扇、沒有扇葉。無文字、無浮水印。`
}
/** What they wear for the two-step placement's first step: the sheet's own. */
export const OWN_CLOTHES: FanOutfit = { text: 'the same simple cream loungewear as in picture 2' }
export const stillClip = (n: number, style?: FanStyle) => ({
  seconds: 4,
  clip: `${lookOf(style).lead}Locked overhead camera, no movement. The person lies still in the same pose for the whole shot, ${POSES[n - 2].clip}, no change of position, so the shot ends on the frame it starts with. No cuts.`,
  sound: 'Quiet room tone and a soft steady whir in the room, faint breathing; no music, no singing.',
})

/** The cut's clock (t4's numbers): the roll until she has settled (cut.ts
 *  settledAt, never before 2.4 s; t4 cut at 3.0 s) and the remote clip from
 *  0.4 s, faded over 0.3 s, make the opening; the fan starts at the remote's
 *  press and a blade passes every 3.2 s; the last outfit stays 1.8 s. */
export const TIMING = { rollMin: 2.4, remoteFrom: 0.4, blend: 0.3, step: 3.2, tail: 1.8, lead: 0.6, overlap: 0.2 }
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
 *  (owner, Oct 18: "elegant, luxury"; start in a dress, "not pants": the
 *  ivory lace after the black gown was "too black"; "add one more beautiful
 *  sexy dress as the last one"). The
 *  first four keep long sleeves or high necks (OpenAI refuses some
 *  lying-down dresses); the red one may be refused there and go to the next
 *  maker. The page starts with all five, the user keeps 2 to 5. */
export const DEFAULT_OUTFITS: Record<string, string[]> = {
  'zh-Hant': ['象牙白蕾絲長袖長禮服', '香檳金亮片長袖禮服', '酒紅色絲絨高領長禮服', '白色粗花呢套裝配珍珠項鍊', '正紅色亮片露肩高衩晚禮服'],
  'zh-Hans': ['象牙白蕾丝长袖长礼服', '香槟金亮片长袖礼服', '酒红色丝绒高领长礼服', '白色粗花呢套装配珍珠项链', '正红色亮片露肩高开衩晚礼服'],
  en: ['Ivory lace long-sleeve gown', 'Champagne-gold sequin long-sleeve gown', 'Burgundy velvet high-neck gown', 'White tweed suit with a pearl necklace', 'Red sequin off-shoulder gown with a high leg slit'],
  ja: ['アイボリーのレースの長袖ロングドレス', 'シャンパンゴールドのスパンコールの長袖ドレス', 'ボルドーのベルベットのハイネックドレス', '白のツイードスーツとパールのネックレス', '赤いスパンコールのオフショルダー、ハイスリットのイブニングドレス'],
  ko: ['아이보리 레이스 롱슬리브 드레스', '샴페인 골드 스팽글 롱슬리브 드레스', '버건디 벨벳 하이넥 드레스', '화이트 트위드 수트와 진주 목걸이', '레드 스팽글 오프숄더 하이 슬릿 이브닝 드레스'],
}

/** The start and end boxes for a look: the sofa's and the rug's places, at the
 *  look's height. */
export function boxesFor(style?: FanStyle) {
  const f = lookOf(style).frame
  return { start: { ...START_BOX, y: f.y, h: f.h }, end: { ...END_BOX, y: f.y, h: f.h }, heads: f.heads, waist: !!f.waist }
}
