// lib/remake/examples.ts: 同款's "try a popular one" row, the hand-picked
// part (owner, Oct 13: "do it. popular AI video with prompts", after
// "at least 10k likes in total"). AI videos on X with 10,000+ likes whose
// authors share the prompt, found with Grok's X search on Oct 13 (seven
// searches at $9.48, plus one stopped early) and each checked with the X API
// the same day: the like count,
// the video, and its length. Left out: real people in the video, other
// people's characters, Sora (the owner never uses it), ads, posts whose
// prompt carries a slur (three @charliebcurran posts, all 10k+), and every
// post by Elon Musk (owner, Oct 13: "they are biased. people like those not
// because they are good"; the route drops him from the feed too). `summary` is our
// own words; `prompt` is the author's, as shared in the post or its thread,
// shown under the read when someone remakes it. Likes only grow, so the counts
// stay true as a floor. The route adds the trending feed's live 10k+ videos.

import type { Lang } from '@/lib/i18n'

export type RemakeExample = {
  url: string
  handle: string
  /** Checked on Oct 13 with the X API. */
  likes: number
  /** The AI models the author credits; empty when they name none. */
  models: string[]
  prompt: string
  summary: Partial<Record<Lang, string>>
}

export const CURATED_EXAMPLES: RemakeExample[] = [
 {
  "url": "https://x.com/biggieU_U/status/2017357936922710474",
  "handle": "biggieU_U",
  "likes": 18955,
  "models": [
   "Genie 3"
  ],
  "prompt": "Make me a AAAA Bethesda-style space RPG about exploring moons. Focus entirely on rock textures, ignore actual gameplay content.",
  "summary": {
   "en": "A generated game world shows a space role-playing trip across moons, with the view lingering on rocky ground.",
   "zh-Hant": "生成的遊戲世界呈現穿越月球的太空角色扮演旅程，畫面停留在岩石地面上。",
   "zh-Hans": "生成的游戏世界呈现穿越月球的太空角色扮演旅程，画面停留在岩石地面上。",
   "ja": "生成されたゲーム世界で月を巡る宇宙RPGの旅が映り、岩の地面が長く映る。",
   "ko": "생성된 게임 세계에서 달을 탐험하는 우주 롤플레잉 여정이 나오고, 화면은 바위 지면에 머문다."
  }
 },
 {
  "url": "https://x.com/john_my07/status/2071977017474789557",
  "handle": "john_my07",
  "likes": 16003,
  "models": [
   "Seedance 2.0"
  ],
  "prompt": "Main subject: young Korean woman, early 20s, natural everyday appearance, faded charcoal-grey sleeveless crop top, loose high-waisted light-wash jeans, black canvas sneakers, black cord necklace, black wavy hair in a messy side ponytail with wispy bangs. Realistic skin texture, minimal makeup, warm and approachable personality. Maintain consistent identity, clothing, hairstyle, and appearance throughout the entire video.\nLocation: Authentic Korean residential neighborhood during a calm late morning. Narrow concrete alleys, low-rise homes, small terraces, potted plants, laundry lines, bicycles, utility poles, overhead wires, mature trees casting moving shadows, quiet residential atmosphere. No stores, advertisements, cafés, crowds, or commercial activity.\nVisual Style: Ultra-realistic documentary realism. Genuine candid behavior. Natural body language. Unscripted slice-of-life feeling. Strong environmental authenticity. Rich real-world details and believable human motion.\nCamera Style: Early-2000s consumer DV camcorder aesthetic. Friend casually recording everyday moments. Heavy handheld shake, imperfect framing, frequent autofocus hunting, lens breathing, exposure pumping when moving between sun and shade, occasional motion blur, subtle rolling shutter, mild digital compression artifacts, faded colors, soft contrast, slight sensor noise. No stabilization. No cinematic camera moves. No modern color grading.\n00:00–00:02\nOutside a small house entrance. She sits on a low concrete wall adjusting her ponytail with both hands raised. A light breeze moves loose strands of hair. She smiles naturally while the camera struggles to hold focus.\n00:02–00:04\nThe camera follows her into a narrow alley lined with potted plants and concrete walls. She notices a stray cat approaching and crouches down. Framing drifts off-center as the operator tries to keep up.\n00:04–00:06\nShe gently pets and feeds the cat. Autofocus repeatedly shifts between her face and the animal. Morning sunlight flickers through leaves overhead.\n00:06–00:08\nSmall front yard beside her house. She hangs laundry on a clothesline while fabrics sway in the breeze. Exposure changes as clouds briefly pass overhead.\n00:08–00:10\nOn a quiet terrace with a ceramic coffee cup. She sits comfortably watching the neighborhood, occasionally brushing hair behind her ear. Loose handheld side angle with natural camera drift.\n00:10–00:12\nClose side profile. Someone off-camera greets her. She turns, raises her hand, smiles warmly, and casually says, “Annyeong.” The camera catches the moment slightly late.\n00:12–00:15\nWalking slowly down a tree-lined residential lane holding her coffee cup. She notices the camera, gives a small genuine smile, then looks away and continues walking. Recording cuts abruptly to black mid-motion as if the camcorder was switched off.\nAudio: Natural ambient sound only — morning birds, distant motorcycles, light wind, leaves rustling, faint neighborhood chatter, cat sounds, footsteps on concrete, fabric moving on clotheslines, subtle residential ambience. No music. No sound design. No narration.\nGoal: Authentic Korean neighborhood life captured like a forgotten home video from the early 2000s — candid, imperfect, realistic, warm, and deeply believable.",
  "summary": {
   "en": "A young woman handles ordinary morning tasks such as fixing her hair, petting a cat, hanging laundry and walking with coffee in a quiet neighborhood, captured with the shaky imperfect look of an old camcorder.",
   "zh-Hant": "一名年輕女子在安靜的社區處理整理頭髮、撫摸貓咪、晾衣服和拿著咖啡行走等平常早晨事務，畫面呈現舊式攝像機的晃動與不完美質感。",
   "zh-Hans": "一名年轻女子在安静的社区处理整理头发、抚摸猫咪、晾衣服和拿着咖啡行走等平常早晨事务，画面呈现旧式摄像机的晃动与不完美质感。",
   "ja": "若い女性が静かな住宅地で髪を直したり猫を撫でたり洗濯を干したりコーヒーを持って歩いたりする日常の朝の作業を、古いビデオカメラの揺れて不完全な映像で捉えている。",
   "ko": "젊은 여성이 조용한 동네에서 머리를 고치고 고양이를 쓰다듬고 빨래를 널고 커피를 들고 걷는 평범한 아침 일을 오래된 캠코더의 흔들리고 불완전한 화면으로 담았다."
  }
 },
 {
  "url": "https://x.com/Ciri_ai/status/2054056372321587555",
  "handle": "Ciri_ai",
  "likes": 10269,
  "models": [
   "Seedance 2.0",
   "GPT Image 2"
  ],
  "prompt": "Ultra-realistic sports broadcast still of a glamorous woman sitting in a packed football stadium crowd during a night match, wearing a dark brown sleeveless high-neck satin top and black square earrings, shoulder-length light brown/blonde hair styled in soft waves. She is casually drinking from a tall blue aluminum can while holding a half-eaten cheeseburger in the other hand. Around her are fans in bright yellow and blue football jerseys and scarves, creating strong team-color contrast. The scene feels candid and cinematic, captured mid-game from a TV broadcast camera angle with shallow depth of field. Include realistic stadium seating, crowded audience atmosphere, broadcast overlay graphics in the top-left corner showing a live football score and match timer, and a sports network watermark in the top-right. Natural arena lighting, detailed skin texture, sharp focus on the woman, slightly blurred background crowd, authentic live sports broadcast aesthetic, 16:9 composition.",
  "summary": {
   "en": "A glamorous woman sits in a packed night football stadium drinking from a blue can and holding a half-eaten cheeseburger among fans in yellow and blue.",
   "zh-Hant": "一位華麗的女性坐在擠滿人的夜間足球場觀眾席，喝著藍色罐子飲料並拿著吃了一半的起司漢堡，周圍是黃藍隊色的球迷。",
   "zh-Hans": "一位华丽的女性坐在挤满人的夜间足球场观众席，喝着蓝色罐子饮料并拿着吃了一半的芝士汉堡，周围是黄蓝队色的球迷。",
   "ja": "華やかな女性が満員の夜のサッカー競技場の観客席に座り、青い缶から飲みながら半分食べたチーズバーガーを持ち、黄と青のファンに囲まれている。",
   "ko": "화려한 여성이 꽉 찬 밤 축구 경기장 관중석에 앉아 파란 캔을 마시며 반쯤 먹은 치즈버거를 들고 있고 노란과 파란 유니폼의 팬들이 둘러싸고 있다."
  }
 },
 {
  "url": "https://x.com/EHuanglu/status/2054399965729091629",
  "handle": "EHuanglu",
  "likes": 10018,
  "models": [],
  "prompt": "14-second 3D Pixar-style animated comedy short, ultra-detailed, vibrant colors, cinematic lighting, smooth 24fps animation, exaggerated expressions and physics, emotional and funny tone.\n\nSHOT 1 (0.00–1.00s) – Wide establishing shot, eye-level, slow push-in: Elegant luxury restaurant interior with chandeliers and oil paintings. Tall male chef (dark beard, white uniform, tall hat) stands beside a table, smiling proudly while lifting a silver cloche to serve an elderly lady seated at a white-tablecloth table. The tiny elderly lady (fluffy light-blue bun, huge gold glasses, pearl jewelry, white cardigan) looks up at him with a knowing smirk. Other diners visible in soft background. Camera gently dollies in.\n\nSHOT 2 (1.00–2.00s) – Tight close-up, high angle, static: Beautifully plated gourmet steak dish (seared filet mignon, broccoli, baby potato, carrots, rosemary, dark sauce) on white gold-rimmed plate with two glasses of red wine. Chef’s torso partially visible in background.\n\nSHOT 3 (2.00–3.00s) – Extreme close-up on elderly lady’s face, eye-level: She takes a bite with a fork, eyes widen with delight then narrow mischievously. She chews while giving a sly side-eye glance toward the chef, one eyebrow raised, smirk growing.\n\nSHOT 4 (3.00–4.00s) – Close-up on male chef’s face, eye-level, slight push-in: His confident smile instantly drops into wide-eyed shock, mouth open, eyebrows raised high. He stares in disbelief.\n\nSHOT 5 (4.00–5.00s) – Extreme close-up on elderly lady’s face again: She lowers the napkin slightly, now wearing a cheeky grin, eyes sparkling with mischief as she looks directly forward.\n\nSHOT 6 (5.00–6.00s) – Wide shot, low angle in professional kitchen: Elderly lady now wearing an oversized chef hat, standing confidently in foreground on a checkered floor in front of blazing gas stoves. Male chef stands behind her in doorway, looking confused. She has both fists on hips, determined expression.\n\nSHOT 7 (6.00–7.00s) – Same kitchen wide shot, dynamic camera tilt down: Blue flames suddenly erupt dramatically from the stovetop around her. She leans forward aggressively, eyes narrowed in fierce concentration, ready to cook.\n\nSHOT 8 (7.00–8.00s) – Dynamic close-up, low angle: Elderly lady (chef hat on) dramatically holds up a large chef’s knife, fierce determined expression, surrounded by flying slices of beef in foreground that frame her like a dramatic action shot.\n\nSHOT 9 (8.00–9.00s) – Extreme close-up, low angle, fast-paced: Fresh lemon half and lime being sliced, juice spraying, with floating broccoli, cherry tomatoes and other vegetables flying through the air in slow-motion around the knife.\n\nSHOT 10 (9.00–10.00s) – Medium close-up in kitchen, eye-level: Elderly lady intensely stirs a sizzling copper pan with a large ladle, steam rising, blue flames underneath. Her face shows pure focus and confidence, eyes narrowed, slight smirk.\n\nSHOT 11 (10.00–11.00s) – Tight close-up, high angle: Her hands elegantly plate the perfectly cooked dish (seared protein, Carrot, cherry tomatoes half, glossy sauce) from the copper pan onto a white plate using a spoon.\n\nSHOT 12 (11.00–12.00s) – Medium two-shot in restaurant, eye-level: Elderly lady proudly holds up the finished plate toward the chef. The male chef, seated at the table, takes a big bite with a fork, eyes bulging in extreme delight and surprise.\n\nSHOT 13 (12.00–13.00s) – Close-up two-shot: Elderly lady leans forward with a huge satisfied smile, gesturing with her hand as if saying “See?” while looking at the chef.\n\nSHOT 14 (13.00–14.00s) – Close-up on male chef’s face: He suddenly starts crying, big cartoon tears rolling down his cheeks.\n\nSHOT 15 (14.00s – end) – Final wide shot, eye-level, slow pull-back: Elderly lady stands triumphantly beside the table, hands clasped, smug satisfied smile. Male chef is on his knees on the floor, head bowed, both hands dramatically holding his tall chef hat above his head",
  "summary": {
   "en": "A mischievous elderly woman takes over a fancy restaurant kitchen and cooks a dish that leaves the proud chef crying in amazement.",
   "zh-Hant": "一位淘氣的老婦人接管高級餐廳的廚房，煮出一道讓自豪廚師驚訝痛哭的菜餚。",
   "zh-Hans": "一位淘气的老妇人接管高级餐厅的厨房，煮出一道让自豪厨师惊讶痛哭的菜肴。",
   "ja": "いたずら好きの老婦人が高級レストランの厨房を乗っ取り、自慢のシェフが驚いて泣く料理を作ります。",
   "ko": "장난기 많은 노부인이 고급 레스토랑 주방을 장악하고 자랑스러운 셰프가 놀라 울 요리를 만듭니다."
  }
 }
]
