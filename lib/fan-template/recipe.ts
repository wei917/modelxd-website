// lib/fan-template/recipe.ts: 風扇變裝 (fan outfit change), the template in
// 同款's tab (owner, Oct 18: "template needs to be more accurate"; "the
// template card should be in 做同款 tab and a new section besides 影片連結
// and popular videos"). Shared by the job, the route and the page.
//
// The method is the run the owner called "very close" (t4, Oct 17), made
// repeatable:
//   1. a four-view sheet of the user from their photos (@quinqueen's prompt,
//      word for word: https://higgsfield.ai/@quinqueen/blogs/chatgpt-higgsfield-reel2);
//   2. the set is fixed: t4's start frame (an AI sample woman on the sofa's
//      edge, the empty mat, the remote; PLATE). The user and outfit 1 are
//      edited into it, so the room and the camera are the same in every run.
//      The prompts say "the person", never she (Oct 18): anyone can use it;
//   3. the opening: a free roll from the sofa onto the mat (Wan image to
//      video: a pinned landing makes people glide), then the remote picked up
//      with one hand, eyes on the camera (Wan first + last frame);
//   4. outfits 2-5 are edits of that frame in the creator's poses, each a
//      still clip with the same picture as its first and last frame;
//   5. our own fan at one steady speed makes the changes (fan.ts), then the
//      captions, the clips' own sound and the music.

import type { MusicTarget } from '@/lib/remake/config'

/** The fixed set: t4's start frame, 1152x2048. */
export const PLATE = { bucket: 'xcreate-user-images', path: 'house/fan-outfit/plate-sofa.jpg' }
/** The card's loop, the demo with music and its poster, in the public landing bucket. */
export const DEMO = { card: 'templates/fan-outfit-card.mp4', video: 'templates/fan-outfit-demo.mp4', poster: 'templates/fan-outfit-poster.jpg' }
export const OUTFITS = 5
/** What a run reserves (cents); it pays what was used, about $3 at list prices. */
export const FAN_RESERVE_CENTS = 400
export const FAN_ABOUT_CENTS = 300

export type FanMusicStyle = 'anime' | Extract<MusicTarget, 'pop' | 'kpop' | 'edm' | 'lofi' | 'rock'>
export const FAN_MUSIC_STYLES: FanMusicStyle[] = ['pop', 'anime', 'kpop', 'edm', 'rock', 'lofi']
export type FanMusic = { choice: 'style' | 'mine' | 'none'; style: FanMusicStyle; track?: string }
export type FanOutfit = { text: string; photo?: string }
export type FanRequest = {
  /** The user's photos in their upload folder: the front one is needed. */
  front: string
  side?: string
  outfits: FanOutfit[]
  /** The caption's top line, the same over every outfit. */
  title: string
  music: FanMusic
  language: string
}

/** Step 1, 人物四視圖指令 (@quinqueen), without the height and weight line
 *  (the template does not ask for them). */
export const SHEET = '請以我上傳的正面及側面照片作為唯一人物身分參考，完整保留人物的五官、臉型、膚色、髮型及個人辨識度。\n\n生成一張白色背景的寫實四格人物設定圖：左上為正面臉部近照、左下為側面臉部近照、中間為正面全身照、右邊為側面全身照。\n\n四格均為同一人物，穿著同一套簡約米白色居家服，赤腳自然站立。確保每格的樣貌、身高、體型及身材比例一致，不加入文字、配件或其他人物。'
/** Only a front photo: the same, said for one photo. */
export const SHEET_FRONT_ONLY = SHEET.replace('正面及側面照片', '正面照片')

const KEEP = '其他全部完全不變：攝影機角度、比例、構圖、光線、沙發、墊子、地板、遙控器。畫面中沒有吊扇、沒有扇葉。無文字、無浮水印。'
const OUTFIT_PHOTO = '服裝的版型、剪裁、布料、顏色、圖案與鞋子完全照最後一張圖片，但不要用那張圖片裡的人。'
/** The set's woman wears white sneakers, and an edit keeps them unless told
 *  (test run, Oct 18: the same sneakers under every outfit). */
const SHOES = '鞋子也要換成搭配這套穿搭的鞋。'

/** Step 2: the user, in outfit 1, on the set's sofa edge (picture 1 is the
 *  set, picture 2 the sheet, picture 3 the outfit photo if any). */
export function startPrompt(outfit: FanOutfit): string {
  return `編輯第一張圖片。把躺在沙發座墊邊緣的人換成第二張人物設定圖裡的人：臉、五官、膚色、髮型、身材和性別完全照設定圖。人物的姿勢、在沙發上的位置、大小、頭朝畫面上方的方向都不變，仍然仰躺在沙發座墊靠墊子那一側的邊緣，看向鏡頭。人物穿著：${outfit.text}。${outfit.photo ? OUTFIT_PHOTO : SHOES}${KEEP}`
}

/** Step 3a, the roll (t4's prompt; owner: "just over a little bit is fine"). */
export const ROLL = {
  seconds: 4,
  clip: `寫實風格的時尚影片，9:16 直式，長度 4 秒，一個連續鏡頭，從這張圖片開始。攝影機完全固定，以精確的 90 度角垂直向下拍攝，俯視地板。攝影機不跟著人物移動：沙發、墊子、地板和遙控器在畫面中的位置從頭到尾完全不動。不得推近、拉遠、水平移動、上下傾斜、旋轉或改變拍攝角度。畫面中沒有吊扇。
0.0–1.5 秒：人物仰躺在沙發座墊靠邊的地方。人物朝畫面右側輕輕翻身成側躺，身體越過座墊邊緣，自然地從沙發上掉到下方約 40 公分的墊子上，以仰躺姿勢落地，頭朝畫面上方，腳朝畫面下方。只翻一點點：不翻成趴著，不連續翻滾，落地後也不再翻身。身體始終貼著沙發或地面，不漂浮、不滑行、不站起來。
1.5–4.0 秒：人物抬眼看向上方的攝影機，放鬆肩膀、伸直雙腿，雙手放在身體兩側，靜靜躺著，一直看著鏡頭。
動作自然，人體結構真實，布料動態合理。不得出現重複人物、多餘肢體、臉部變化、漂浮的身體部位或場景切換。`,
  sound: 'Quiet room tone, a soft thump as the person lands on the mat, a rustle of fabric. No music, no singing.',
}

/** Step 3b's end frame: the remote in hand, eyes on the camera (t4). */
export const HOLDING = 'Edit this picture. Keep everything exactly as it is: the room, the sofa, the mat, the floor, every object and where it is, the camera position and angle, the framing, the light and shadows, and the clothes, face, hair, pose and position of the person. Change only this: the left hand of the person (the hand on the right side of the frame) now holds the small silver remote, resting on the mat beside their hip, and the remote is no longer lying on the mat; their eyes look straight up into the camera. No text, no letters, no logos.'

/** Step 3b, the remote (owner: "look straight to the camera"; one hand). */
export const REMOTE = {
  seconds: 5,
  clip: 'Locked overhead camera, no movement, no zoom, no rotation. The person keeps their head still and their eyes looking straight up into the camera the whole time; they never look at the remote. At 0.5 s their left hand (on the right side of the frame) closes around the small silver remote lying beside it, without looking at it; at 1.5 s they raise the remote toward the camera and press the button once with their thumb; at 2.5 s they lower that hand back to the mat beside their hip, still holding the remote, and then lie still. Their other hand stays still at their side. No cuts.',
  sound: 'Quiet room tone, a soft click of a remote button. No music, no singing.',
}

/** Outfits 2-5 in the creator's poses (their timeline, 5.5-15.0 s). */
export const POSES: { pose: string; clip: string }[] = [
  { pose: '人物仰躺在墊子上同一個位置，雙手放在腰部附近、手肘朝外，腳踝輕輕交叉，頭部微微轉向一側。', clip: 'breathing softly, at 1.5 s the head turns a few degrees' },
  { pose: '人物仰躺在墊子上同一個位置，一隻手放在臀部，另一隻手放在墊子上，雙膝略微偏向一側。', clip: 'breathing gently, at 1.2 s one slow blink' },
  { pose: '人物仰躺在墊子上同一個位置，雙臂交叉在胸前，腳踝輕輕交叉，自信地看向上方的鏡頭。', clip: 'breathing softly, at 1 s a faint confident smile' },
  { pose: '人物仰躺在墊子上同一個位置，一隻手放在腹部，另一隻手自然向外伸展，臉稍微轉向沙發，表情放鬆。', clip: 'breathing gently, at 0.5 s a soft small smile' },
]

/** Outfit n (2-5) as an edit: picture 1 the base frame, picture 2 the sheet,
 *  picture 3 the outfit photo if any. */
export function outfitPrompt(n: number, outfit: FanOutfit): string {
  const p = POSES[n - 2]
  return `編輯第一張圖片。房間、沙發、墊子、地板、攝影機位置與角度、構圖、光線和陰影全部完全不變。人物的臉、五官、膚色、髮型、身材和性別完全照第二張人物設定圖。只改兩件事：人物換上這套服裝：${outfit.text}。${outfit.photo ? OUTFIT_PHOTO : SHOES}${p.pose}小型銀色遙控器放在墊子上、人物左手（畫面右側那隻手）旁邊，不在手裡。畫面中沒有吊扇、沒有扇葉。無文字、無浮水印。`
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

/** The music: an original instrumental for the template's length, hits at
 *  the fan's start and each change. 'anime' is the trend's own sound (the
 *  reference's style as the read heard it, never its song). */
const STYLE_WORDS: Record<FanMusicStyle, string> = {
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

/** The page's opening outfits and title, in the page's language: five
 *  everyday looks (t3's). */
export const DEFAULT_OUTFITS: Record<string, string[]> = {
  'zh-Hant': ['米色針織外套配淺色牛仔褲', '紅色大衣配黑色長褲', '深藍碎花長洋裝', '黑色皮衣配黑色長褲', '粉色毛呢外套配百褶裙'],
  'zh-Hans': ['米色针织外套配浅色牛仔裤', '红色大衣配黑色长裤', '深蓝碎花长连衣裙', '黑色皮衣配黑色长裤', '粉色毛呢外套配百褶裙'],
  en: ['Beige knit cardigan with light jeans', 'Red wool coat with black trousers', 'Navy floral maxi dress', 'Black leather jacket with black trousers', 'Pink wool coat with a pleated skirt'],
  ja: ['ベージュのニットカーディガンとライトデニム', '赤いウールコートと黒のパンツ', 'ネイビーの花柄ロングワンピース', '黒のレザージャケットと黒のパンツ', 'ピンクのウールコートとプリーツスカート'],
  ko: ['베이지 니트 가디건과 연청 청바지', '빨간 울 코트와 검정 바지', '네이비 꽃무늬 롱 원피스', '검정 가죽 재킷과 검정 바지', '핑크 울 코트와 플리츠 스커트'],
}
export const DEFAULT_TITLE: Record<string, string> = {
  'zh-Hant': '日常穿搭系列', 'zh-Hans': '日常穿搭系列', en: 'Outfit of the week', ja: '毎日コーデ', ko: '데일리 코디',
}
